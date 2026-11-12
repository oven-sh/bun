// templates with blocks, partials, helpers, paths, else, inverted sections, each with index and key, whitespace control
'use strict';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
class Engine {
  constructor() { this.helpers = Object.create(null); this.partials = Object.create(null); this.cache = new Map(); this.compiled = 0;
    this.helper('if', function (v, o) { return (Array.isArray(v) ? v.length : v) ? o.fn(this) : o.inverse(this); });
    this.helper('unless', function (v, o) { return (Array.isArray(v) ? v.length : v) ? o.inverse(this) : o.fn(this); });
    this.helper('with', function (v, o) { return v ? o.fn(v) : o.inverse(this); });
    this.helper('each', function (list, o) { if (!list || typeof list !== 'object') return o.inverse(this); const keys = Object.keys(list); if (!keys.length) return o.inverse(this); let out = ''; keys.forEach((k, i) => { out += o.fn(list[k], { index: i, key: k, first: i === 0, last: i === keys.length - 1 }, o.as && [list[k], k]); }); return out; });
  }
  helper(n, f) { this.helpers[n] = f; return this; }
  partial(n, t) { this.partials[n] = t; this.cache.delete(n); return this; }
  parse(text) {
    const re = /\{\{(~)?(?:!--([\s\S]*?)--|!([\s\S]*?)|\{([\s\S]*?)\}|([#\/^>&]|else\b)?\s*([\s\S]*?))(~)?\}\}/g, root = { body: [], inverse: null }, stack = [root];
    let last = 0, m, trim = false;
    const cur = () => { const t = stack[stack.length - 1]; return t.inverse || t.body; };
    while ((m = re.exec(text)) !== null) {
      let raw = text.slice(last, m.index);
      if (trim) raw = raw.replace(/^\s+/, '');
      if (m[1]) raw = raw.replace(/\s+$/, '');
      if (raw) cur().push({ t: 'text', v: raw });
      trim = !!m[7]; last = re.lastIndex;
      if (m[2] !== undefined || m[3] !== undefined) continue;
      if (m[4] !== undefined) { cur().push({ t: 'raw', ...this.expr(m[4]) }); continue; }
      const [kind, body] = [m[5], m[6].trim()];
      switch (kind) {
        case '#': { const as = /^(.*?)\s+as\s+\|([^|]+)\|$/.exec(body), n = { t: 'block', body: [], inverse: null, ...this.expr(as ? as[1] : body), as: as ? as[2].trim().split(/\s+/) : null }; cur().push(n); stack.push(n); break; }
        case '^': if (body) { const n = { t: 'block', body: [], inverse: [], ...this.expr('unless ' + body), as: null }; n.name = body; n.inverted = true; cur().push(n); stack.push(n); break; }
        case 'else': { const top = stack[stack.length - 1]; if (top === root) throw new SyntaxError('else outside a block'); if (body && kind === 'else') { top.inverse = []; const n = { t: 'block', body: [], inverse: null, chained: true, ...this.expr(body), as: null }; top.inverse.push(n); stack.push(n); } else top.inverse = []; break; }
        case '/': { let top = stack.pop(); while (top && top.chained) top = stack.pop(); if (!top || top === root || top.name !== body) throw new SyntaxError('{{/' + body + '}} does not close ' + (top && top.name)); break; }
        case '>': cur().push({ t: 'partial', ...this.expr(body) }); break;
        case '&': cur().push({ t: 'raw', ...this.expr(body) }); break;
        default: cur().push({ t: 'value', ...this.expr(body) });
      }
    }
    let raw = text.slice(last); if (trim) raw = raw.replace(/^\s+/, '');
    if (raw) cur().push({ t: 'text', v: raw });
    if (stack.length > 1) throw new SyntaxError('open block ' + stack[1].name);
    return root.body;
  }
  expr(s) { const parts = s.match(/\w+=(?:"[^"]*"|'[^']*'|\S+)|"[^"]*"|'[^']*'|\([^()]*\)|[^\s()]+/g) || [''], hash = {}, args = []; for (let i = 1; i < parts.length; i++) { const h = /^(\w+)=([\s\S]+)$/.exec(parts[i]); if (h) hash[h[1]] = this.arg(h[2]); else args.push(this.arg(parts[i])); } return { name: parts[0], args, hash }; }
  arg(s) { let m; if ((m = /^"([^"]*)"$|^'([^']*)'$/.exec(s))) return { k: 'lit', v: m[1] ?? m[2] }; if (/^-?\d+(\.\d+)?$/.test(s)) return { k: 'lit', v: +s }; if (s === 'true' || s === 'false') return { k: 'lit', v: s === 'true' }; if (s === 'null' || s === 'undefined') return { k: 'lit', v: s === 'null' ? null : undefined }; if (s[0] === '(') return { k: 'sub', ...this.expr(s.slice(1, -1)) }; return { k: 'path', v: s }; }
  lookup(path, c) { if (path === 'this' || path === '.') return c.self; if (path[0] === '@') return path.slice(1) === 'root' ? c.root : c.data[path.slice(1)]; while (path.startsWith('../')) { path = path.slice(3); c = c.parent || c; } const parts = path.replace(/\[([^\]]*)\]/g, '$1').split(/[.\/]/); if (parts[0] === 'this') { parts.shift(); } else if (own(c.vars, parts[0])) { let v = c.vars[parts.shift()]; for (const p of parts) v = v == null ? undefined : v[p]; return v; } let v = c.self; for (const p of parts) { if (v == null) return undefined; v = own(Object(v), p) ? v[p] : undefined; } return v; }
  value(a, c) { switch (a.k) { case 'lit': return a.v; case 'sub': return this.call(a, c, {}); default: return this.lookup(a.v, c); } }
  call(n, c, extra) { const h = this.helpers[n.name]; if (h) { const hash = {}; for (const k in n.hash) hash[k] = this.value(n.hash[k], c); return h.apply(c.self, n.args.map(a => this.value(a, c)).concat({ hash, name: n.name, data: c.data, ...extra })); } if (n.args.length) throw new ReferenceError('Missing helper: ' + n.name); const v = this.value(this.arg(n.name), c); return typeof v === 'function' ? v.call(c.self, { hash: {}, ...extra }) : v; }
  run(nodes, c) {
    let out = '';
    for (const n of nodes) switch (n.t) {
      case 'text': out += n.v; break;
      case 'raw': { const v = this.call(n, c, {}); out += v == null ? '' : v; break; }
      case 'value': { const v = this.call(n, c, {}); out += v == null || v === false ? '' : v && v.html !== undefined ? v.html : String(v).replace(/[&<>"'`=]/g, x => '&#x' + x.charCodeAt(0).toString(16).toUpperCase() + ';'); break; }
      case 'partial': { const t = this.partials[n.name]; if (t === undefined) throw new ReferenceError('no partial ' + n.name); if ((c.depth || 0) > 20) throw new RangeError('partials too deep'); let ast = this.cache.get(n.name); if (!ast) { this.compiled++; this.cache.set(n.name, ast = this.parse(t)); } let self = n.args.length ? this.value(n.args[0], c) : c.self; const hash = {}; for (const k in n.hash) hash[k] = this.value(n.hash[k], c); if (Object.keys(n.hash).length) self = Object.assign({}, self, hash); out += this.run(ast, { self, parent: c, root: c.root, data: c.data, vars: c.vars, depth: (c.depth || 0) + 1 }); break; }
      case 'block': { const make = (body, data, as) => (self, d, bound) => { const vars = Object.assign({}, c.vars); if (as && bound) as.forEach((name, i) => { vars[name] = bound[i]; }); return body ? this.run(body, { self, parent: self === c.self ? c.parent : c, root: c.root, data: d ? Object.assign({}, data, d) : data, vars, depth: c.depth }) : ''; }; const fn = make(n.body, c.data, n.as), inverse = make(n.inverse, c.data); if (n.inverted) { const v = this.lookup(n.name, c); if (!v || Array.isArray(v) && !v.length) out += fn(c.self); break; } if (this.helpers[n.name]) { out += this.call(n, c, { fn, inverse, as: n.as }); break; } const v = this.call(n, c, { fn, inverse }); if (Array.isArray(v)) { if (v.length) v.forEach((x, i) => { out += fn(x, { index: i }); }); else out += inverse(c.self); } else if (v === true) out += fn(c.self); else if (v) out += fn(v); else out += inverse(c.self); }
    }
    return out;
  }
  render(text, self) { const ast = this.parse(text); this.compiled++; return this.run(ast, { self, root: self, data: {}, vars: {} }); }
}
module.exports = Engine;
