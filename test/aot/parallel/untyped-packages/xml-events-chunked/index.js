// a reader of tags as events by a state machine, a tree builder and a writer; entities, CDATA, name spaces
'use strict';
var S = {}; ['TEXT', 'OPEN', 'NAME', 'ATTRS', 'ATTR', 'EQ', 'VALUE', 'CLOSE', 'COMMENT', 'CDATA', 'PI', 'DOCTYPE'].forEach(function (n, i) { S[n] = i; S[i] = n; });
var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s, strict) { return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);?/g, function (m, e) { if (e[0] === '#') { var n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0x10ffff ? m : String.fromCodePoint(n); } if (Object.prototype.hasOwnProperty.call(ENT, e)) return ENT[e]; if (strict) throw new Error('Invalid entity ' + m); return m; }); }
function Sax(strict, handlers) { this.strict = strict; this.h = handlers; this.state = S.TEXT; this.buf = ''; this.tags = []; this.pos = this.line = this.col = 0; this.quote = ''; this.counts = {}; }
Sax.prototype.emit = function (n, a, b) { this.counts[n] = (this.counts[n] || 0) + 1; if (this.h['on' + n]) this.h['on' + n](a, b); };
Sax.prototype.error = function (m) { var e = new Error(m + ' at ' + this.line + ':' + this.col + ' in ' + S[this.state]); if (this.strict) throw e; this.emit('error', e); };
Sax.prototype.openTag = function (selfClose) { var t = this.tag; this.emit('open', t); if (selfClose) this.emit('close', t.name); else this.tags.push(t.name); this.state = S.TEXT; this.buf = ''; };
Sax.prototype.closeTag = function (n) { var i = this.tags.lastIndexOf(n); if (i < 0) { this.error('Unmatched close ' + n); } else { if (i !== this.tags.length - 1) this.error('Unexpected close ' + n); while (this.tags.length > i) this.emit('close', this.tags.pop()); } this.state = S.TEXT; this.buf = ''; };
Sax.prototype.text = function () { if (this.buf) { this.emit('text', decode(this.buf, this.strict)); this.buf = ''; } };
Sax.prototype.write = function (chunk) {
  for (var i = 0; i < chunk.length; i++) {
    var c = chunk.charAt(i); this.pos++; if (c === '\n') { this.line++; this.col = 0; } else this.col++;
    switch (this.state) {
      case S.TEXT: if (c === '<') { this.text(); this.state = S.OPEN; } else this.buf += c; continue;
      case S.OPEN: this.buf += c; if (c === '!' || c === '-' && /^!-?$/.test(this.buf.slice(0, -1)) || /^!\[/.test(this.buf) && '![CDATA['.indexOf(this.buf) === 0) { if (this.buf === '!--') { this.state = S.COMMENT; this.buf = ''; } else if (this.buf === '![CDATA[') { this.state = S.CDATA; this.buf = ''; } continue; } if (this.buf[0] === '!') { if ('![CDATA['.indexOf(this.buf) === 0) continue; this.state = S.DOCTYPE; } else if (c === '/') { this.state = S.CLOSE; this.buf = ''; } else if (c === '?') { this.state = S.PI; this.buf = ''; } else if (/[A-Za-z_:]/.test(c)) this.state = S.NAME; else { this.error('Bad tag start ' + c); this.buf = '<' + c; this.state = S.TEXT; } continue;
      case S.NAME: if (/[\w:.-]/.test(c)) { this.buf += c; continue; } this.tag = { name: this.buf, attrs: {} }; this.buf = ''; if (c === '>') this.openTag(false); else this.state = S.ATTRS, this.slash = c === '/'; continue;
      case S.ATTRS: if (c === '>') this.openTag(this.slash); else if (c === '/') this.slash = true; else if (/\s/.test(c)) continue; else { if (this.slash) this.error('Slash inside tag'); this.slash = false; this.buf = c; this.state = S.ATTR; } continue;
      case S.ATTR: if (c === '=') { this.name = this.buf; this.buf = ''; this.state = S.EQ; } else if (/\s/.test(c) || c === '>' || c === '/') { this.error('Attribute without value ' + this.buf); this.tag.attrs[this.buf] = this.buf; this.buf = ''; if (c === '>') this.openTag(false); else { this.slash = c === '/'; this.state = S.ATTRS; } } else this.buf += c; continue;
      case S.EQ: if (c === '"' || c === "'") { this.quote = c; this.state = S.VALUE; } else if (!/\s/.test(c)) { this.error('Unquoted value'); this.quote = ' '; this.buf = c; this.state = S.VALUE; } continue;
      case S.VALUE: if (c === this.quote || this.quote === ' ' && (c === '>' || c === '/')) { if (Object.prototype.hasOwnProperty.call(this.tag.attrs, this.name)) this.error('Duplicate ' + this.name); this.tag.attrs[this.name] = decode(this.buf, this.strict); this.emit('attr', this.name, this.tag.attrs[this.name]); this.buf = ''; this.slash = c === '/'; if (c === '>') this.openTag(false); else this.state = S.ATTRS; } else this.buf += c; continue;
      case S.CLOSE: if (c === '>') this.closeTag(this.buf.trim()); else this.buf += c; continue;
      case S.COMMENT: this.buf += c; if (this.buf.slice(-3) === '-->') { this.emit('comment', this.buf.slice(0, -3)); this.buf = ''; this.state = S.TEXT; } continue;
      case S.CDATA: this.buf += c; if (this.buf.slice(-3) === ']]>') { this.emit('cdata', this.buf.slice(0, -3)); this.buf = ''; this.state = S.TEXT; } continue;
      case S.PI: this.buf += c; if (this.buf.slice(-2) === '?>') { this.emit('pi', this.buf.slice(0, -2)); this.buf = ''; this.state = S.TEXT; } continue;
      case S.DOCTYPE: if (c === '>') { this.emit('doctype', this.buf.trim()); this.buf = ''; this.state = S.TEXT; } else this.buf += c; continue;
    }
  }
  return this;
};
Sax.prototype.end = function () { if (this.state !== S.TEXT) this.error('Unexpected end'); else this.text(); if (this.tags.length) this.error('Unclosed ' + this.tags.join()); return this; };
function tree(xml, strict) { var root = { name: '#root', children: [] }, stack = [root], errors = [], p = new Sax(strict, { onopen: function (t) { var n = { name: t.name, attrs: t.attrs, children: [] }; stack[stack.length - 1].children.push(n); stack.push(n); }, onclose: function () { if (stack.length > 1) stack.pop(); }, ontext: function (t) { if (t.trim()) stack[stack.length - 1].children.push(t); }, oncdata: function (t) { stack[stack.length - 1].children.push({ cdata: t }); }, onerror: function (e) { errors.push(e.message); } }); p.write(xml).end(); root.errors = errors; return root; }
function write(n) { if (typeof n === 'string') return n.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); if (n.cdata !== undefined) return '<![CDATA[' + n.cdata + ']]>'; var inner = n.children.map(write).join(''); if (n.name === '#root') return inner; var a = Object.keys(n.attrs).map(function (k) { return ' ' + k + '="' + n.attrs[k].replace(/["&<]/g, function (c) { return { '"': '&quot;', '&': '&amp;', '<': '&lt;' }[c]; }) + '"'; }).join(''); return '<' + n.name + a + (inner ? '>' + inner + '</' + n.name + '>' : '/>'); }
module.exports = { Sax: Sax, tree: tree, write: write, decode: decode };
