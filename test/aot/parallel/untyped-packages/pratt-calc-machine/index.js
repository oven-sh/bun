// a lexer, a parser by precedence, an evaluator with scopes, a printer, a simplifier and code for a stack machine
'use strict';
var TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z_]\w*)|"((?:[^"\\]|\\.)*)"|(\*\*|=>|[=!<>]=|&&|\|\||[-+*\/%<>!?:=(),;\[\]{}]))/y;
function lex(src) { var out = [], m; TOKEN.lastIndex = 0; while (TOKEN.lastIndex < src.length) { var at = TOKEN.lastIndex; m = TOKEN.exec(src); if (!m) { if (/^\s*$/.test(src.slice(at))) break; throw new SyntaxError('bad character ' + src[at] + ' at ' + at); } var t = { at: at + m[0].search(/\S/) }; for (var i = 1; i < 5; i++) if (m[i] !== undefined) { t.kind = [, 'num', 'name', 'str', 'op'][i]; t.text = m[i]; } out.push(t); } out.push({ kind: 'end', text: '', at: src.length }); return out; }
var BP = { '=': [2, 1], '?': [4, 3], '||': [5, 6], '&&': [7, 8], '==': [9, 10], '!=': [9, 10], '<': [11, 12], '>': [11, 12], '<=': [11, 12], '>=': [11, 12], '+': [13, 14], '-': [13, 14], '*': [15, 16], '/': [15, 16], '%': [15, 16], '**': [19, 18], '(': [21, 0], '[': [21, 0] };
function Parser(src) { this.t = lex(src); this.i = 0; }
Parser.prototype = {
  constructor: Parser,
  get peek() { return this.t[this.i]; },
  next: function () { return this.t[this.i++]; },
  eat: function (text) { var t = this.next(); if (t.text !== text || t.kind === 'str') throw new SyntaxError('expected ' + text + ' at ' + t.at + ', got ' + (t.text || t.kind)); return t; },
  program: function () { var list = []; while (this.peek.kind !== 'end') { list.push(this.expr(0)); if (this.peek.text === ';') this.next(); else if (this.peek.kind !== 'end') this.eat(';'); } return { k: 'seq', list: list }; },
  expr: function (min) {
    var t = this.next(), left;
    switch (t.kind) {
      case 'num': left = { k: 'num', v: +t.text }; break;
      case 'str': left = { k: 'str', v: t.text.replace(/\\(.)/g, function (m, c) { return c === 'n' ? '\n' : c; }) }; break;
      case 'name': if (t.text === 'fn') { this.eat('('); var ps = []; while (this.peek.text !== ')') { ps.push(this.next().text); if (this.peek.text === ',') this.next(); } this.next(); this.eat('=>'); left = { k: 'fn', ps: ps, body: this.expr(1) }; } else left = { k: 'name', v: t.text }; break;
      case 'op': if (t.text === '(') { left = this.expr(0); this.eat(')'); break; } if (t.text === '[') { left = { k: 'list', list: this.args(']') }; break; } if (t.text === '-' || t.text === '!') { left = { k: 'un', op: t.text, a: this.expr(17) }; break; }
      // falls through
      default: throw new SyntaxError('unexpected ' + (t.text || 'end') + ' at ' + t.at);
    }
    for (;;) {
      var op = this.peek, bp = op.kind === 'op' && BP.hasOwnProperty(op.text) ? BP[op.text] : null;
      if (!bp || bp[0] < min) return left;
      this.next();
      if (op.text === '(') left = { k: 'call', f: left, args: this.args(')') };
      else if (op.text === '[') { left = { k: 'at', a: left, b: this.expr(0) }; this.eat(']'); }
      else if (op.text === '?') { var a = this.expr(0); this.eat(':'); left = { k: 'if', c: left, a: a, b: this.expr(bp[1]) }; }
      else if (op.text === '=') { if (left.k !== 'name') throw new SyntaxError('cannot assign at ' + op.at); left = { k: 'set', n: left.v, v: this.expr(bp[1]) }; }
      else left = { k: 'bin', op: op.text, a: left, b: this.expr(bp[1]) };
    }
  },
  args: function (end) { var out = []; while (this.peek.text !== end) { out.push(this.expr(1)); if (this.peek.text === ',') this.next(); else if (this.peek.text !== end) this.eat(','); } this.next(); return out; }
};
var OPS = { '+': function (a, b) { return a + b; }, '-': function (a, b) { return a - b; }, '*': function (a, b) { return a * b; }, '/': function (a, b) { return a / b; }, '%': function (a, b) { return a % b; }, '**': function (a, b) { return Math.pow(a, b); }, '==': function (a, b) { return a === b; }, '!=': function (a, b) { return a !== b; }, '<': function (a, b) { return a < b; }, '>': function (a, b) { return a > b; }, '<=': function (a, b) { return a <= b; }, '>=': function (a, b) { return a >= b; } };
function Scope(up) { this.up = up; this.vars = Object.create(null); this.steps = up ? up.steps : { n: 0 }; }
Scope.prototype.find = function (n) { for (var s = this; s; s = s.up) if (n in s.vars) return s; return null; };
function run(n, s) {
  if (++s.steps.n > 20000) throw new RangeError('too many steps');
  switch (n.k) {
    case 'num': case 'str': return n.v;
    case 'name': var f = s.find(n.v); if (!f) throw new ReferenceError(n.v + ' is not defined'); return f.vars[n.v];
    case 'list': return n.list.map(function (x) { return run(x, s); });
    case 'un': var v = run(n.a, s); return n.op === '-' ? -v : !v;
    case 'bin': if (n.op === '&&') return run(n.a, s) && run(n.b, s); if (n.op === '||') return run(n.a, s) || run(n.b, s); return OPS[n.op](run(n.a, s), run(n.b, s));
    case 'if': return run(n.c, s) ? run(n.a, s) : run(n.b, s);
    case 'set': return (s.find(n.n) || s).vars[n.n] = run(n.v, s);
    case 'fn': return function () { var inner = new Scope(s); for (var i = 0; i < n.ps.length; i++) inner.vars[n.ps[i]] = arguments[i]; return run(n.body, inner); };
    case 'call': var fn = run(n.f, s); if (typeof fn !== 'function') throw new TypeError(print(n.f) + ' is not a function'); return fn.apply(null, n.args.map(function (x) { return run(x, s); }));
    case 'at': return run(n.a, s)[run(n.b, s)];
    case 'seq': var r; n.list.forEach(function (x) { r = run(x, s); }); return r;
  }
}
function print(n, up) { up = up || 0; function wrap(bp, t) { return bp < up ? '(' + t + ')' : t; } switch (n.k) { case 'num': return String(n.v); case 'str': return JSON.stringify(n.v); case 'name': return n.v; case 'un': return wrap(17, n.op + print(n.a, 17)); case 'bin': var b = BP[n.op]; return wrap(Math.min(b[0], b[1]), print(n.a, b[0]) + ' ' + n.op + ' ' + print(n.b, b[1])); case 'if': return wrap(3, print(n.c, 4) + ' ? ' + print(n.a) + ' : ' + print(n.b, 3)); case 'set': return wrap(1, n.n + ' = ' + print(n.v, 1)); case 'fn': return 'fn(' + n.ps.join(', ') + ') => ' + print(n.body, 1); case 'call': return print(n.f, 21) + '(' + n.args.map(function (a) { return print(a, 1); }).join(', ') + ')'; case 'list': return '[' + n.list.map(function (a) { return print(a, 1); }).join(', ') + ']'; case 'at': return print(n.a, 21) + '[' + print(n.b) + ']'; case 'seq': return n.list.map(function (x) { return print(x); }).join('; '); } }
function fold(n) { switch (n.k) { case 'bin': var a = fold(n.a), b = fold(n.b); if (a.k === 'num' && b.k === 'num' && OPS[n.op]) { var v = OPS[n.op](a.v, b.v); if (typeof v === 'number') return { k: 'num', v: v }; } if (n.op === '*' && (b.k === 'num' && b.v === 1)) return a; if (n.op === '+' && a.k === 'num' && a.v === 0) return b; return { k: 'bin', op: n.op, a: a, b: b }; case 'un': var x = fold(n.a); return x.k === 'num' && n.op === '-' ? { k: 'num', v: -x.v } : { k: 'un', op: n.op, a: x }; case 'if': return { k: 'if', c: fold(n.c), a: fold(n.a), b: fold(n.b) }; case 'seq': return { k: 'seq', list: n.list.map(fold) }; case 'call': return { k: 'call', f: fold(n.f), args: n.args.map(fold) }; case 'fn': return { k: 'fn', ps: n.ps, body: fold(n.body) }; case 'set': return { k: 'set', n: n.n, v: fold(n.v) }; default: return n; } }
function compile(n, out) { out = out || []; switch (n.k) { case 'num': out.push(['push', n.v]); break; case 'name': out.push(['get', n.v]); break; case 'un': compile(n.a, out); out.push([n.op === '-' ? 'neg' : 'not']); break; case 'bin': compile(n.a, out); if (n.op === '&&' || n.op === '||') { var j = [n.op === '&&' ? 'jf' : 'jt', 0]; out.push(j, ['pop']); compile(n.b, out); j[1] = out.length; } else { compile(n.b, out); out.push(['op', n.op]); } break; case 'if': compile(n.c, out); var f = ['jpf', 0], e = ['jmp', 0]; out.push(f); compile(n.a, out); out.push(e); f[1] = out.length; compile(n.b, out); e[1] = out.length; break; case 'set': compile(n.v, out); out.push(['set', n.n]); break; case 'seq': n.list.forEach(function (x, i) { if (i) out.push(['pop']); compile(x, out); }); break; default: throw new Error('no code for ' + n.k); } return out; }
function machine(code, vars) { var st = [], pc = 0, ticks = 0; while (pc < code.length) { var c = code[pc++]; ticks++; switch (c[0]) { case 'push': st.push(c[1]); break; case 'pop': st.pop(); break; case 'get': st.push(vars[c[1]]); break; case 'set': vars[c[1]] = st[st.length - 1]; break; case 'neg': st.push(-st.pop()); break; case 'not': st.push(!st.pop()); break; case 'op': var b = st.pop(), a = st.pop(); st.push(OPS[c[1]](a, b)); break; case 'jf': if (!st[st.length - 1]) pc = c[1]; break; case 'jt': if (st[st.length - 1]) pc = c[1]; break; case 'jpf': if (!st.pop()) pc = c[1]; break; case 'jmp': pc = c[1]; break; } } return [st.pop(), ticks]; }
module.exports = { parse: function (s) { return new Parser(s).program(); }, run: run, Scope: Scope, print: print, fold: fold, compile: compile, machine: machine, lex: lex, OPS: OPS };
