// an expression engine by hand: parsed to a tree, compiled to instructions, run by backtracking threads with captures
'use strict';
class Parser {
  constructor(src, flags = '') { this.src = src; this.i = 0; this.groups = 0; this.names = {}; this.ignore = flags.includes('i'); }
  fail(m) { throw new SyntaxError(m + ' at ' + this.i); }
  alt() { const list = [this.seq()]; while (this.src[this.i] === '|') { this.i++; list.push(this.seq()); } return list.length === 1 ? list[0] : { t: 'alt', list }; }
  seq() { const list = []; while (this.i < this.src.length && this.src[this.i] !== '|' && this.src[this.i] !== ')') list.push(this.repeat()); return { t: 'seq', list }; }
  repeat() { let atom = this.atom(); for (;;) { const c = this.src[this.i]; let min, max; if (c === '*') [min, max] = [0, Infinity]; else if (c === '+') [min, max] = [1, Infinity]; else if (c === '?') [min, max] = [0, 1]; else if (c === '{') { const m = /^\{(\d+)(?:(,)(\d+)?)?\}/.exec(this.src.slice(this.i)); if (!m) return atom; min = +m[1]; max = m[2] === undefined ? min : m[3] === undefined ? Infinity : +m[3]; if (max < min) this.fail('bad repeat'); this.i += m[0].length - 1; } else return atom; this.i++; const lazy = this.src[this.i] === '?'; if (lazy) this.i++; if (atom.t === 'rep') this.fail('nothing to repeat'); atom = { t: 'rep', atom, min, max, lazy }; } }
  atom() { const c = this.src[this.i++]; switch (c) { case '(': { let n = null, look = 0; if (this.src.startsWith('?:', this.i)) this.i += 2; else if (/^\?[=!]/.test(this.src.slice(this.i))) { look = this.src[this.i + 1] === '=' ? 1 : -1; this.i += 2; } else { const m = /^\?<(\w+)>/.exec(this.src.slice(this.i)); n = ++this.groups; if (m) { this.names[m[1]] = n; this.i += m[0].length; } } const body = this.alt(); if (this.src[this.i++] !== ')') this.fail('open group'); return look ? { t: 'look', body, not: look < 0 } : n ? { t: 'group', n, body } : body; } case '[': return this.set(); case '.': return { t: 'set', not: true, items: [['\n', '\n']] }; case '^': return { t: 'bol' }; case '$': return { t: 'eol' }; case '\\': return this.escape(); case '*': case '+': case '?': this.i--; return this.fail('nothing to repeat'); default: return { t: 'char', c }; } }
  cls(c) { switch (c) { case 'd': return [['0', '9']]; case 'w': return [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']]; case 's': return [[' ', ' '], ['\t', '\r']]; } }
  escape() { const c = this.src[this.i++]; if (c === undefined) this.fail('open escape'); if (/[dws]/.test(c)) return { t: 'set', items: this.cls(c) }; if (/[DWS]/.test(c)) return { t: 'set', not: true, items: this.cls(c.toLowerCase()) }; if (c === 'b') return { t: 'word' }; if (/[1-9]/.test(c)) return { t: 'back', n: +c }; return { t: 'char', c: { n: '\n', t: '\t' }[c] || c }; }
  set() { const items = []; let not = false; if (this.src[this.i] === '^') { not = true; this.i++; } while (this.src[this.i] !== ']') { if (this.i >= this.src.length) this.fail('open set'); let a = this.src[this.i++]; if (a === '\\') { const e = this.src[this.i++], k = this.cls(e); if (k) { items.push(...k); continue; } a = { n: '\n', t: '\t' }[e] || e; } if (this.src[this.i] === '-' && this.src[this.i + 1] !== ']') { const b = this.src[this.i + 1]; this.i += 2; if (b < a) this.fail('bad range'); items.push([a, b]); } else items.push([a, a]); } this.i++; return { t: 'set', not, items }; }
}
function emit(n, out, p) {
  switch (n.t) {
    case 'char': out.push({ op: 'char', c: p.ignore ? n.c.toLowerCase() : n.c }); break;
    case 'set': out.push({ op: 'set', not: !!n.not, items: n.items }); break;
    case 'seq': for (const x of n.list) emit(x, out, p); break;
    case 'alt': { const ends = []; n.list.forEach((x, i) => { if (i === n.list.length - 1) return emit(x, out, p); const s = { op: 'split', a: out.length + 1, b: 0 }; out.push(s); emit(x, out, p); const j = { op: 'jump', a: 0 }; out.push(j); ends.push(j); s.b = out.length; }); for (const j of ends) j.a = out.length; break; }
    case 'group': out.push({ op: 'save', n: n.n * 2 }); emit(n.body, out, p); out.push({ op: 'save', n: n.n * 2 + 1 }); break;
    case 'rep': { for (let i = 0; i < n.min; i++) emit(n.atom, out, p); const put = s => { if (n.lazy) [s.a, s.b] = [s.b, s.a]; }; if (n.max === Infinity) { const s = { op: 'split', a: out.length + 1, b: 0 }, at = out.length; out.push(s, { op: 'mark', n: at }); emit(n.atom, out, p); out.push({ op: 'moved', n: at }, { op: 'jump', a: at }); s.b = out.length; put(s); } else { const ss = []; for (let i = n.min; i < n.max; i++) { const s = { op: 'split', a: out.length + 1, b: 0 }; ss.push(s); out.push(s); emit(n.atom, out, p); } for (const s of ss) { s.b = out.length; put(s); } } break; }
    case 'look': { const l = { op: 'look', not: n.not, code: [] }; emit(n.body, l.code, p); l.code.push({ op: 'match' }); out.push(l); break; }
    default: out.push({ op: n.t, n: n.n });
  }
  return out;
}
class Regex {
  constructor(src, flags = '') { const p = new Parser(src, flags); const tree = p.alt(); if (p.i < src.length) p.fail('unmatched )'); this.groups = p.groups; this.names = p.names; this.ignore = p.ignore; this.code = emit(tree, [], p); this.code.push({ op: 'match' }); this.steps = 0; }
  has(i, c) { const fits = x => i.items.some(([a, b]) => x >= a && x <= b); let r = fits(c); if (!r && this.ignore) r = fits(c.toLowerCase()) || fits(c.toUpperCase()); return r !== i.not; }
  run(code, s, at, caps) {
    const stack = [[0, at, caps, {}]], word = k => k >= 0 && k < s.length && /\w/.test(s[k]);
    while (stack.length) {
      let [pc, i, c, marks] = stack.pop();
      thread: for (;;) {
        if (++this.steps > 100000) throw new RangeError('too many steps');
        const x = code[pc++];
        switch (x.op) {
          case 'char': if (i >= s.length || (this.ignore ? s[i].toLowerCase() : s[i]) !== x.c) break thread; i++; break;
          case 'set': if (i >= s.length || !this.has(x, s[i])) break thread; i++; break;
          case 'split': stack.push([x.b, i, c, marks]); pc = x.a; break;
          case 'jump': pc = x.a; break;
          case 'save': c = c.slice(); c[x.n] = i; break;
          case 'mark': marks = { ...marks, [x.n]: i }; break;
          case 'moved': if (marks[x.n] === i) break thread; break;
          case 'bol': if (i !== 0) break thread; break;
          case 'eol': if (i !== s.length) break thread; break;
          case 'word': if (word(i - 1) === word(i)) break thread; break;
          case 'back': { const t = c[x.n * 2 + 1] === undefined ? '' : s.slice(c[x.n * 2], c[x.n * 2 + 1]); if (!s.startsWith(t, i)) break thread; i += t.length; break; }
          case 'look': { const r = this.run(x.code, s, i, c); if (!!r === x.not) break thread; if (r && !x.not) c = r.caps; break; }
          case 'match': return { end: i, caps: c };
        }
      }
    }
    return null;
  }
  exec(s, from = 0) { for (let i = from; i <= s.length; i++) { const r = this.run(this.code, s, i, []); if (r) { const m = [s.slice(i, r.end)]; for (let g = 1; g <= this.groups; g++) m[g] = r.caps[g * 2 + 1] === undefined ? undefined : s.slice(r.caps[g * 2], r.caps[g * 2 + 1]); m.index = i; m.named = {}; for (const n in this.names) m.named[n] = m[this.names[n]]; return m; } } return null; }
  replace(s, f) { let out = '', at = 0, m; while (at <= s.length && (m = this.exec(s, at))) { out += s.slice(at, m.index) + (typeof f === 'function' ? f(...m, m.index) : f.replace(/\$(\d)/g, (_, d) => m[d] ?? '')); at = m.index + m[0].length; if (!m[0].length) { out += s[at] ?? ''; at++; } } return out + s.slice(at); }
}
module.exports = Regex;
