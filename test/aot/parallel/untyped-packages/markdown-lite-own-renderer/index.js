// blocks by a chain of expressions eating the text from its start; spans by one sticky expression; a renderer class with methods that may be overridden
'use strict';
var block = {
  newline: /^\n+/, code: /^( {4}[^\n]+\n*)+/, fences: /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:\n\1[ ]*(?=\n|$)|$)/, hr: /^ {0,3}((?:-[ ]*){3,}|(?:_[ ]*){3,}|(?:\*[ ]*){3,})(?:\n+|$)/,
  heading: /^ {0,3}(#{1,6}) +([^\n]*?)(?: +#+)? *(?:\n+|$)/, quote: /^( {0,3}> ?[^\n]*(?:\n|$))+/, list: /^((?:[*+-]|\d+\.) [\s\S]+?)(?:\n\n(?! )(?!(?:[*+-]|\d+\.) )\n*|\s*$)/, def: /^ {0,3}\[([^\]]+)\]: *<?([^\s>]+)>?(?: +["(]([^"\n]+)[")])? *(?:\n+|$)/,
  table: /^ *\|?(.+)\n *\|?( *[-:]+[-| :]*)(?:\n((?: *[^>\n ].*(?:\n|$))*)\n*|$)/, paragraph: /^([^\n]+(?:\n(?! {0,3}(?:#{1,6} |> |`{3}|[*+-] |\d+\. ))[^\n]+)*)/, text: /^[^\n]+/
};
function Renderer(o) { this.options = o || {}; }
Renderer.prototype.heading = function (t, level) { return '<h' + level + '>' + t + '</h' + level + '>\n'; };
Renderer.prototype.paragraph = function (t) { return '<p>' + t + '</p>\n'; };
Renderer.prototype.code = function (t, lang) { return '<pre' + (lang ? ' class="' + lang + '"' : '') + '>' + escape(t) + '</pre>\n'; };
Renderer.prototype.list = function (items, ordered, start) { var tag = ordered ? 'ol' : 'ul'; return '<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>' + items.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</' + tag + '>\n'; };
Renderer.prototype.link = function (href, title, t) { return '<a href="' + href + '"' + (title ? ' title="' + title + '"' : '') + '>' + t + '</a>'; };
Renderer.prototype.table = function (head, rows) { return '<table>' + [head].concat(rows).map(function (r, i) { return '<tr>' + r.map(function (c) { return (i ? '<td' : '<th') + (c.align ? ' align=' + c.align : '') + '>' + c.text; }).join('') + '</tr>'; }).join('') + '</table>\n'; };
function escape(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function cells(row, n) { var c = row.replace(/^ *\|? */, '').replace(/ *\| *$/, '').split(/ *\| */); while (c.length < n) c.push(''); return n ? c.slice(0, n) : c; }
function Parser(o) { this.options = o || {}; this.links = {}; this.renderer = this.options.renderer || new Renderer(this.options); this.used = {}; }
Parser.prototype.lex = function (src) {
  var tokens = [], cap, names = ['newline', 'code', 'fences', 'heading', 'hr', 'quote', 'list', 'def', 'table', 'paragraph', 'text'];
  outer: while (src) {
    for (var i = 0; i < names.length; i++) {
      if (!(cap = block[names[i]].exec(src))) continue;
      if (names[i] === 'table' && cap[2].indexOf('-') < 0) continue;
      src = src.substring(cap[0].length);
      this.used[names[i]] = (this.used[names[i]] || 0) + 1;
      if (names[i] === 'def') { if (!this.links[cap[1].toLowerCase()]) this.links[cap[1].toLowerCase()] = { href: cap[2], title: cap[3] }; continue outer; }
      var parts = []; for (var k = 1; k < cap.length; k++) parts.push(cap[k]);
      tokens.push({ type: names[i], raw: cap[0], parts: parts });
      continue outer;
    }
    throw new Error('Infinite loop on ' + src.charCodeAt(0));
  }
  return tokens;
};
var span = /\\([\\`*_\[\]()#+.!-])|(`+)([\s\S]*?[^`])\2(?!`)|(\*\*|__)(?=\S)([\s\S]*?\S)\4|([*_])(?=\S)([\s\S]*?\S)\6|!?\[([^\]]*)\](?:\(([^\s)]*)(?: "([^"]*)")?\)|\[([^\]]*)\])?|<(https?:[^>]+)>|  \n|[&<>"]/g;
Parser.prototype.inline = function (s) {
  var self = this, r = this.renderer, last = 0, out = '', m, re = new RegExp(span.source, 'g');
  while ((m = re.exec(s)) !== null) {
    out += s.slice(last, m.index); last = re.lastIndex;
    if (m[1] !== undefined) out += m[1];
    else if (m[2]) out += '<code>' + escape(m[3].trim()) + '</code>';
    else if (m[4]) out += '<strong>' + self.inline(m[5]) + '</strong>';
    else if (m[6]) out += '<em>' + self.inline(m[7]) + '</em>';
    else if (m[8] !== undefined) { var l = m[9] !== undefined ? { href: m[9], title: m[10] } : self.links[(m[11] || m[8]).toLowerCase()]; out += l ? m[0][0] === '!' ? '<img src="' + l.href + '" alt="' + m[8] + '">' : r.link(l.href, l.title, self.inline(m[8])) : m[0]; }
    else if (m[12]) out += r.link(m[12], null, m[12]);
    else out += m[0] === '  \n' ? '<br>' : escape(m[0]);
  }
  return out + s.slice(last);
};
Parser.prototype.render = function (src) {
  var out = '', self = this, r = this.renderer, tokens = this.lex(src.replace(/\r\n|\r/g, '\n').replace(/\t/g, '    '));
  tokens.forEach(function (t) {
    var p = t.parts;
    switch (t.type) {
      case 'heading': out += r.heading(self.inline(p[1]), p[0].length); break;
      case 'hr': out += '<hr>\n'; break;
      case 'code': out += r.code(t.raw.replace(/^ {4}/gm, '').replace(/\n+$/, '')); break;
      case 'fences': out += r.code(p[2], p[1].trim()); break;
      case 'quote': out += '<blockquote>' + self.render(t.raw.replace(/^ *> ?/gm, '')) + '</blockquote>\n'; break;
      case 'list': var ordered = /^\d/.test(p[0]), items = p[0].split(/\n(?=(?:[*+-]|\d+\.) )/).map(function (i) { return self.inline(i.replace(/^(?:[*+-]|\d+\.) /, '').replace(/\n +/g, ' ')); }); out += r.list(items, ordered, parseInt(p[0], 10)); break;
      case 'table': var head = cells(p[0]), align = cells(p[1]).map(function (a) { return /^:.*:$/.test(a) ? 'center' : /:$/.test(a) ? 'right' : /^:/.test(a) ? 'left' : null; }); out += r.table(head.map(function (h, i) { return { text: self.inline(h), align: align[i] }; }), (p[2] || '').replace(/\n$/, '').split('\n').filter(Boolean).map(function (row) { return cells(row, head.length).map(function (c, i) { return { text: self.inline(c), align: align[i] }; }); })); break;
      case 'paragraph': case 'text': out += r.paragraph(self.inline(p[0] || t.raw)); break;
    }
  });
  return out;
};
module.exports = { Parser: Parser, Renderer: Renderer, escape: escape };
