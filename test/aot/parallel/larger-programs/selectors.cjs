// A document of elements read from text, selectors compiled to tests, queries with an index, styles that cascade, mutations with observers, text printed again
'use strict';
var EventEmitter = require('events'), util = require('util');
var VOID = new Set(['br', 'img', 'input', 'hr']);
function Node(doc) {
  this.doc = doc;
  this.parent = null;
}
Object.defineProperty(Node.prototype, 'index', { get: function () {
  return this.parent ? this.parent.children.indexOf(this) : -1;
}
});
Node.prototype.remove = function () {
  if (this.parent) {
    this.parent.children.splice(this.index, 1);
    var p = this.parent;
    this.parent = null;
    this.doc.changed('removed', p, this);
  }
  return this;
};
function Text(doc, value) {
  Node.call(this, doc);
  this.value = value;
}
util.inherits(Text, Node);
Text.prototype.html = function () {
  return escapeText(this.value);
};
Object.defineProperty(Text.prototype, 'text', { get: function () {
  return this.value;
}
});
function Element(doc, tag, attrs) {
  Node.call(this, doc);
  this.tag = tag;
  this.attrs = attrs || {
};
  this.children = [];
  this.id_ = ++Element.count;
  this.styles = null;
}
util.inherits(Element, Node);
Element.count = 0;
Object.defineProperties(Element.prototype, { elements: { get: function () {
  return this.children.filter(function (c) {
    return c instanceof Element;
});
}
}, id: { get: function () {
  return this.attrs.id;
}
}, classes: { get: function () {
  return (this.attrs['class'] || '').split(/\s+/).filter(Boolean);
}
}, text: { get: function () {
  return this.children.map(function (c) {
    return c.text;
}).join('');
}, set: function (t) {
  while (this.children.length) this.children[0].remove();
  this.append(new Text(this.doc, t));
}
}, depth: { get: function () {
  var n = 0;
  for (var e = this.parent; e; e = e.parent) n++;
  return n;
}
} });
Element.prototype.append = function () {
  for (var i = 0; i < arguments.length; i++) {
    var c = arguments[i];
    if (typeof c === 'string') c = new Text(this.doc, c);
    if (c.parent) c.remove();
    c.parent = this;
    this.children.push(c);
    this.doc.changed('added', this, c);
  }
  return this;
};
Element.prototype.before = function (c, ref) {
  c.remove();
  c.parent = this;
  this.children.splice(ref.index, 0, c);
  this.doc.changed('added', this, c);
  return c;
};
Element.prototype.set = function (k, v) {
  var old = this.attrs[k];
  if (v === null) delete this.attrs[k];
  else this.attrs[k] = String(v);
  if (old !== this.attrs[k]) this.doc.changed('attribute', this, k);
  return this;
};
Element.prototype.toggle = function (name) {
  var c = this.classes, i = c.indexOf(name);
  if (i < 0) c.push(name);
  else c.splice(i, 1);
  this.set('class', c.length ? c.join(' ') : null);
  return i < 0;
};
Element.prototype.walk = function* () {
  yield this;
  for (var i = 0; i < this.children.length; i++) if (this.children[i] instanceof Element) yield* this.children[i].walk();
};
Element.prototype.html = function () {
  var a = '';
  for (var k in this.attrs) a += ' ' + k + (this.attrs[k] === '' ? '' : '="' + this.attrs[k].replace(/[&"]/g,
    function (c) {
    return c === '&' ? '&amp;' : '&quot;';
}) + '"');
  var open = '<' + this.tag + a + '>';
  return VOID.has(this.tag) ? open : open + this.children.map(function (c) {
    return c.html();
}).join('') + '</' + this.tag + '>';
};
Element.prototype.matches = function (s) {
  return this.doc.compile(s).some(function (c) {
    return c.test(this);
}, this);
};
Element.prototype.closest = function (s) {
  for (var e = this; e; e = e.parent) if (e.matches(s)) return e;
  return null;
};
Element.prototype.query = function (s) {
  return this.doc.query(s, this);
};
function escapeText(s) {
  return s.replace(/[&<>]/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
});
}
function unescapeText(s) {
  return s.replace(/&(amp|lt|gt|quot|#\d+);/g, function (all, n) {
    return n[0] === '#' ? String.fromCharCode(+n.slice(1)) : {
      amp: '&', lt: '<', gt: '>', quot: '"'
  }[n];
});
}
function Document(html) {
  EventEmitter.call(this);
  this.cache = new Map();
  this.index = null;
  this.tested = 0;
  this.changes = {
    added: 0, removed: 0, attribute: 0
};
  this.root = new Element(this, 'root');
  this.warnings = [];
  this.parse(html || '', this.root);
}
util.inherits(Document, EventEmitter);
Document.prototype.changed = function (kind, target, what) {
  this.changes[kind]++;
  this.index = null;
  this.emit('change', kind, target, what);
};
Document.prototype.parse = function (html, into) {
  var re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g,
    stack = [into], m, self = this;
  while ((m = re.exec(html))) {
    var top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      var t = unescapeText(m[5]);
      if (t.trim()) top.append(new Text(this, t));
  } else if (m[2]) {
      var attrs = {
    };
      m[3].replace(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, function (_, k,
        a, b, c) {
        attrs[k] = unescapeText(a !== undefined ? a : b !== undefined ? b : c !== undefined ? c : '');
        return '';
    });
      var e = new Element(this, m[2].toLowerCase(), attrs);
      top.append(e);
      if (!m[4] && !VOID.has(e.tag)) stack.push(e);
  } else if (m[1]) {
      var i = stack.length - 1;
      while (i > 0 && stack[i].tag !== m[1].toLowerCase()) i--;
      if (i === 0) self.warnings.push('no open ' + m[1]);
      else {
        if (i !== stack.length - 1) self.warnings.push('closed over ' + stack.slice(i + 1).map(function (x) {
          return x.tag;
      }).join());
        stack.length = i;
      }
    }
  }
  if (stack.length > 1) this.warnings.push('open ' + stack.slice(1).map(function (x) {
    return x.tag;
}).join());
  return into;
};
function Compound() {
  this.tag = null;
  this.tests = [];
  this.id = null;
  this.classes = [];
  this.weight = [0, 0, 0];
}
Compound.prototype.test = function (e) {
  e.doc.tested++;
  if (this.tag && e.tag !== this.tag) return false;
  if (this.id !== null && e.attrs.id !== this.id) return false;
  for (var i = 0; i < this.classes.length; i++) if (e.classes.indexOf(this.classes[i]) < 0) return false;
  for (i = 0; i < this.tests.length; i++) if (!this.tests[i](e)) return false;
  return true;
};
function Complex(parts) {
  this.parts = parts;
  this.weight = parts.reduce(function (w, p) {
    return w.map(function (x, i) {
      return x + p.compound.weight[i];
  });
}, [0, 0, 0]);
}
Complex.prototype.test = function (e) {
  return this.at(e, this.parts.length - 1);
};
Complex.prototype.at = function (e, i) {
  if (!e || e.tag === 'root' || !this.parts[i].compound.test(e)) return false;
  if (i === 0) return true;
  var p, siblings, k;
  switch (this.parts[i].by) {
    case '>': return this.at(e.parent, i - 1);
    case '+': siblings = e.parent.elements;
    k = siblings.indexOf(e);
    return k > 0 && this.at(siblings[k - 1], i - 1);
    case '~': siblings = e.parent.elements;
    for (k = siblings.indexOf(e) - 1; k >= 0; k--) if (this.at(siblings[k], i - 1)) return true;
    return false;
    default: for (p = e.parent; p; p = p.parent) if (this.at(p, i - 1)) return true;
    return false;
  }
};
function nth(text) {
  if (text === 'odd') text = '2n+1';
  if (text === 'even') text = '2n';
  var m = /^([+-]?\d*)n(?:\s*([+-]\s*\d+))?$|^([+-]?\d+)$/.exec(text.trim());
  if (!m) throw new SyntaxError('bad nth ' + text);
  if (m[3] !== undefined) return function (i) {
    return i === +m[3];
};
  var a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : +m[1],
    b = m[2] ? +m[2].replace(/\s/g, '') : 0;
  return function (i) {
    return a === 0 ? i === b : (i - b) / a >= 0 && (i - b) % a === 0;
};
}
var PSEUDO = {
  'first-child': function () {
    return function (e) {
      return e.parent.elements[0] === e;
  };
}, 'last-child': function () {
    return function (e) {
      var s = e.parent.elements;
      return s[s.length - 1] === e;
  };
}, 'only-child': function () {
    return function (e) {
      return e.parent.elements.length === 1;
  };
}, empty: function () {
    return function (e) {
      return e.children.length === 0;
  };
}, 'nth-child': function (arg) {
    var f = nth(arg);
    return function (e) {
      return f(e.parent.elements.indexOf(e) + 1);
  };
}, 'nth-last-child': function (arg) {
    var f = nth(arg);
    return function (e) {
      var s = e.parent.elements;
      return f(s.length - s.indexOf(e));
  };
}, not: function (arg, doc) {
    var l = doc.compile(arg);
    return function (e) {
      return !l.some(function (c) {
        return c.test(e);
    });
  };
}, is: function (arg, doc) {
    var l = doc.compile(arg);
    return function (e) {
      return l.some(function (c) {
        return c.test(e);
    });
  };
}, has: function (arg, doc) {
    var l = doc.compile(arg);
    return function (e) {
      for (var x of e.walk()) if (x !== e && l.some(function (c) {
        return c.test(x);
    })) return true;
      return false;
  };
}, contains: function (arg) {
    var t = arg.replace(/^["']|["']$/g, '');
    return function (e) {
      return e.text.indexOf(t) >= 0;
  };
  }
};
Document.prototype.compile = function (text) {
  var kept = this.cache.get(text);
  if (kept) return kept;
  var s = text.trim(), i = 0, out = [], parts = [], by = null, self = this;
  function fail(why) {
    throw new SyntaxError(why + ' in selector ' + JSON.stringify(text));
  }
  function name() {
    var m = /^[\w-]+/.exec(s.slice(i));
    if (!m) fail('expected a name');
    i += m[0].length;
    return m[0];
  }
  function compound() {
    var c = new Compound(), from = i;
    if (s[i] === '*') i++;
    else if (/[a-z]/i.test(s[i] || '')) {
      c.tag = name().toLowerCase();
      c.weight[2]++;
    }
    for (;;) {
      switch (s[i]) {
        case '#': i++;
        c.id = name();
        c.weight[0]++;
        continue;
        case '.': i++;
        c.classes.push(name());
        c.weight[1]++;
        continue;
        case '[': {
          var m = /^\[\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\]/.exec(s.slice(i));
          if (!m) fail('bad attribute');
          i += m[0].length;
          c.weight[1]++;
          (function (k, op, v) {
            c.tests.push(function (e) {
              var a = e.attrs[k];
              if (a === undefined) return false;
              switch (op) {
                case undefined: return true;
                case '=': return a === v;
                case '~=': return a.split(/\s+/).indexOf(v) >= 0;
                case '^=': return v !== '' && a.indexOf(v) === 0;
                case '$=': return v !== '' && a.slice(-v.length) === v;
                case '*=': return v !== '' && a.indexOf(v) >= 0;
                default: return a === v || a.indexOf(v + '-') === 0;
              }
          });
        }(m[1], m[2], m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5]));
          continue;
        }
        case ':': {
          i++;
          var n = name(), arg = null;
          if (s[i] === '(') {
            var d = 1, start = ++i;
            while (i < s.length && d) {
              if (s[i] === '(') d++;
              else if (s[i] === ')') d--;
              i++;
            }
            if (d) fail('open (');
            arg = s.slice(start, i - 1);
          }
          if (!PSEUDO[n]) fail('unknown :' + n);
          c.tests.push(PSEUDO[n](arg, self));
          c.weight[1]++;
          continue;
        }
      }
      break;
    }
    if (i === from) fail(i >= s.length ? 'selector ends' : 'unexpected ' + s[i]);
    return c;
  }
  for (;;) {
    parts.push({ by: by, compound: compound() });
    var m = /^\s*([>+~,])\s*|^\s+/.exec(s.slice(i));
    if (!m) {
      if (i < s.length) fail('unexpected ' + s[i]);
      out.push(new Complex(parts));
      break;
    }
    i += m[0].length;
    if (m[1] === ',') {
      out.push(new Complex(parts));
      parts = [];
      by = null;
  } else by = m[1] || ' ';
  }
  this.cache.set(text, out);
  return out;
};
Document.prototype.indexed = function () {
  if (!this.index) {
    var byId = new Map(), byClass = new Map(), byTag = new Map(), order = new Map(), n = 0;
    for (var e of this.root.walk()) {
      order.set(e, n++);
      if (e.attrs.id !== undefined && !byId.has(e.attrs.id)) byId.set(e.attrs.id, e);
      e.classes.forEach(function (c) {
        var l = byClass.get(c);
        if (l) l.push(e);
        else byClass.set(c, [e]);
    });
      var t = byTag.get(e.tag);
      if (t) t.push(e);
      else byTag.set(e.tag, [e]);
    }
    this.index = {
      id: byId, cls: byClass, tag: byTag, order: order
  };
  }
  return this.index;
};
Document.prototype.query = function (text, under) {
  var list = this.compile(text), ix = this.indexed(), found = new Set(), self = this;
  list.forEach(function (c) {
    var last = c.parts[c.parts.length - 1].compound;
    var from = last.id !== null ? (ix.id.has(last.id) ? [ix.id.get(last.id)] : []) : last.classes.length ? ix.cls.get(last.classes[0]) ||
      [] : last.tag ? ix.tag.get(last.tag) || [] : ix.order.keys();
    for (var e of from) {
      if (under && under !== self.root) {
        var p = e.parent;
        while (p && p !== under) p = p.parent;
        if (!p) continue;
      }
      if (!found.has(e) && c.test(e)) found.add(e);
    }
});
  return [...found].sort(function (a, b) {
    return ix.order.get(a) - ix.order.get(b);
});
};
function Sheet(doc, text) {
  this.doc = doc;
  this.rules = [];
  var self = this, n = 0;
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^}]*)\}/g, function (_, sel,
    body) {
    var decl = body.split(';').map(function (d) {
      var m = /^\s*([\w-]+)\s*:\s*(.*?)\s*(!important)?\s*$/.exec(d);
      return m ? {
        name: m[1], value: m[2], important: !!m[3]
    } : null;
  }).filter(Boolean);
    doc.compile(sel).forEach(function (c) {
      self.rules.push({ selector: c, decl: decl, order: n++ });
  });
    return '';
});
}
Sheet.INHERITED = ['color', 'font', 'size'];
Sheet.prototype.style = function (e) {
  var all = [];
  this.rules.forEach(function (r) {
    if (r.selector.test(e)) r.decl.forEach(function (d) {
      all.push({ d: d, w: r.selector.weight, o: r.order });
  });
});
  all.sort(function (a, b) {
    return a.d.important - b.d.important || a.w[0] - b.w[0] || a.w[1] - b.w[1] ||
      a.w[2] - b.w[2] || a.o - b.o;
});
  var out = {
}, up = e.parent && e.parent.tag !== 'root' ? this.style(e.parent) : {
};
  Sheet.INHERITED.forEach(function (k) {
    if (k in up) out[k] = up[k];
});
  all.forEach(function (x) {
    out[x.d.name] = x.d.value === 'inherit' ? up[x.d.name] : x.d.value;
});
  return out;
};
var html = '<html><head><title>T &amp; t</title></head><body class="page"><div id="top" class="box big"><h1>Head</h1><p class="note first" data-n="1">One <b>bold</b> text</p><p data-n="22" lang="en-us">Two</p><br><ul>' + Array.from({ length: 40 },
  function (_, i) {
  return '<li class="item ' + (i % 3 ? 'odd' : 'third') + '" data-k="k' + i + '"' + (i % 7 ? '' : ' hidden') + '>item ' + i + (i % 5 ? '' : ' <a href="#' + i + '">link</a>') + '</li>';
}).join('') + '</ul></div><div class="box"><p></p><section><p>deep <i>i</i></p></section></div><!-- note --></p><span>open';
var doc = new Document(html);
console.log(doc.warnings.join('; '), Element.count);
var events = 0;
doc.on('change', function () {
  events++;
});
var selectors = ['p', '#top', '.box', 'div.box.big > p', 'ul li:first-child',
  'li:nth-child(3n+1).odd', 'li:nth-last-child(-n+2)', 'p + p', 'h1 ~ p', '[data-n]',
  '[data-n="22"]', '[lang|=en]', '[data-k^=k1][data-k$="5"]', 'li:not(.odd):not([hidden])',
  'div:has(section i)', ':is(h1, b) , i', 'p:empty', 'li:contains("item 3") a',
  'body *:only-child', 'li:nth-child(even) > a[href*="1"]', 'div div, section > p > i',
  '.none'];
selectors.forEach(function (s) {
  try {
    var r = doc.query(s);
    console.log(s, '=>', r.length, r.slice(0, 4).map(function (e) {
      return e.tag + (e.id ? '#' + e.id : '') + (e.attrs['data-k'] || '');
  }).join());
} catch (e) {
    console.log(s, '=>', e.name, e.message);
  }
});
['', 'p >', '::x', 'p[', 'li:nth-child(x)', ':foo', 'a(', '#'].forEach(function (s) {
  try {
    doc.query(s);
    console.log('fine', s);
} catch (e) {
    console.log(e.name, e.message);
  }
});
var mixed = 0;
for (var i = 0; i < 700; i++) {
  var lis = doc.query('li');
  switch (i % 7) {
    case 0: doc.query('ul')[0].append(new Element(doc, 'li', { 'class': 'item new',
      'data-k': 'n' + i }));
    break;
    case 1: lis[i % lis.length].toggle('odd');
    break;
    case 2: lis[(i * 3) % lis.length].set('data-x', i % 4 ? i : null);
    break;
    case 3: if (lis.length > 30) lis[(i * 5) % lis.length].remove();
    break;
    case 4: lis[0].parent.before(lis[lis.length - 1], lis[i % (lis.length - 1)]);
    break;
    case 5: doc.query('h1')[0].text = 'Head ' + i + ' <&>';
    break;
    default: mixed = (mixed * 31 + doc.query(selectors[i % selectors.length]).length) >>> 0;
  }
  mixed = (mixed * 31 + doc.query('li.odd:nth-child(3n)').length + (lis[0].closest('div.big') ? 1 : 0)) >>> 0;
}
console.log(mixed, events, JSON.stringify(doc.changes), doc.tested, doc.cache.size);
var sheet = new Sheet(doc,
  'p { color: red; margin: 1 } .note { color: green } #top p { color: blue; font: x !important } p.first { font: y; size: 3 } body { size: 10 } b { color: inherit; weight: bold } li:nth-child(2) { color: grey } /* c */ .item.odd, .item.third { pad: 2 }');
['p.note', 'p.note b', 'section i', 'li:nth-child(2)', 'li.third', 'h1'].forEach(function (s) {
  var e = doc.query(s)[0];
  if (!e) return console.log(s, 'none');
  console.log(s, JSON.stringify(sheet.style(e)), e.depth);
});
var sum = 0;
for (var e of doc.root.walk()) sum += JSON.stringify(sheet.style(e)).length;
console.log(sum, sheet.rules.length, doc.query('section').length, doc.root.html().length,
  doc.query('h1')[0].html(), doc.query('p.note')[0].html());
