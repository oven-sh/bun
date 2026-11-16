// versions parsed by one expression; ranges by a table of rewrites, comparators and or-lists
'use strict';
const FULL = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z.-]+))?\s*$/;
const X = /^([<>]?=?|\^|~>?)\s*v?(\d+|[xX*])(?:\.(\d+|[xX*])(?:\.(\d+|[xX*])(?:-([0-9A-Za-z.-]+))?)?)?$/;
const HYPHEN = /^\s*(\S+)\s+-\s+(\S+)\s*$/;
class Version {
  constructor(text) {
    if (text instanceof Version) text = text.version;
    const m = FULL.exec(text);
    if (!m) throw new TypeError('Invalid version: ' + text);
    this.numbers = [];
    for (let i = 1; i < 4; i++) this.numbers.push(+m[i]);
    this.pre = m[4] ? m[4].split('.').map(id => /^\d+$/.test(id) ? +id : id) : [];
    this.build = m[5];
    this.version = this.numbers.join('.') + (this.pre.length ? '-' + this.pre.join('.') : '');
  }
  compare(o) {
    for (let i = 0; i < 3; i++) { if (this.numbers[i] !== o.numbers[i]) return this.numbers[i] < o.numbers[i] ? -1 : 1; }
    if (!this.pre.length || !o.pre.length) return this.pre.length ? -1 : o.pre.length ? 1 : 0;
    for (let i = 0; ; i++) {
      const a = this.pre[i], b = o.pre[i];
      if (a === undefined && b === undefined) return 0;
      if (b === undefined) return 1;
      if (a === undefined) return -1;
      if (a === b) continue;
      if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1;
      return a < b ? -1 : 1;
    }
  }
  inc(part, id) {
    const n = this.numbers;
    switch (part) {
      case 'major': n[0]++; n[1] = n[2] = 0; this.pre = []; break;
      case 'minor': n[1]++; n[2] = 0; this.pre = []; break;
      case 'patch': if (!this.pre.length) n[2]++; this.pre = []; break;
      case 'pre': { let k = this.pre.length; while (--k >= 0) if (typeof this.pre[k] === 'number') { this.pre[k]++; break; } if (k < 0) this.pre.push(0); if (id && this.pre[0] !== id) this.pre = [id, 0]; break; }
      default: throw new Error('invalid part ' + part);
    }
    this.version = n.join('.') + (this.pre.length ? '-' + this.pre.join('.') : '');
    return this;
  }
  toString() { return this.version; }
}
const isX = s => !s || s === 'x' || s === 'X' || s === '*';
function expand(c) {
  const m = X.exec(c);
  if (!m) { if (c === '' || c === '*') return []; throw new TypeError('Invalid comparator: ' + c); }
  const [, op, M, n, p, pre] = m, top = (a, b, d) => [a, b, d].join('.');
  if (isX(M)) return op === '<' || op === '>' ? [['<', '0.0.0-0']] : [];
  const lo = top(+M, isX(n) ? 0 : +n, isX(p) ? 0 : +p) + (pre ? '-' + pre : '');
  switch (op) {
    case '^': return [['>=', lo], ['<', +M > 0 || isX(n) ? top(+M + 1, 0, 0) : +n > 0 || isX(p) ? top(0, +n + 1, 0) : top(0, 0, +p + 1)]];
    case '~': case '~>': return [['>=', lo], ['<', isX(n) ? top(+M + 1, 0, 0) : top(+M, +n + 1, 0)]];
    case '>': return isX(n) ? [['>=', top(+M + 1, 0, 0)]] : isX(p) ? [['>=', top(+M, +n + 1, 0)]] : [['>', lo]];
    case '<=': return isX(n) ? [['<', top(+M + 1, 0, 0)]] : isX(p) ? [['<', top(+M, +n + 1, 0)]] : [['<=', lo]];
    case '>=': case '<': return [[op, lo]];
    default: return isX(n) ? [['>=', lo], ['<', top(+M + 1, 0, 0)]] : isX(p) ? [['>=', lo], ['<', top(+M, +n + 1, 0)]] : [['=', lo]];
  }
}
class Range {
  constructor(text) {
    this.raw = text;
    this.set = text.split('||').map(part => {
      const h = HYPHEN.exec(part);
      const list = h ? expand('>=' + h[1]).concat(expand('<=' + h[2])) : part.trim().replace(/([<>=~^]) +/g, '$1').split(/\s+/).map(expand).flat();
      return list.map(([op, v]) => ({ op, v: new Version(v) }));
    });
  }
  test(v) {
    v = new Version(v);
    for (const and of this.set) {
      let ok = true;
      for (let i = 0; ok && i < and.length; i++) { const c = v.compare(and[i].v); switch (and[i].op) { case '<': ok = c < 0; break; case '<=': ok = c <= 0; break; case '>': ok = c > 0; break; case '>=': ok = c >= 0; break; default: ok = c === 0; } }
      if (ok && v.pre.length) ok = and.some(x => x.v.pre.length && x.v.numbers.join() === v.numbers.join());
      if (ok) return true;
    }
    return false;
  }
  toString() { return this.set.map(a => a.map(c => (c.op === '=' ? '' : c.op) + c.v).join(' ')).join('||'); }
}
module.exports = { Version, Range, compare: (a, b) => new Version(a).compare(new Version(b)), max: (list, range) => { const r = new Range(range); return list.filter(v => r.test(v)).sort(module.exports.compare).pop() || null; } };
