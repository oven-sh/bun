// A logic language: terms, unification with a trail, clauses, cut, negation, lists, arithmetic, assert and retract, a reader with operators
'use strict';
var util = require('util');
function Term() {
}
function Atom(name) {
  Term.call(this);
  this.name = name;
}
util.inherits(Atom, Term);
Atom.all = Object.create(null);
Atom.of = function (name) {
  return Atom.all[name] || (Atom.all[name] = new Atom(name));
};
function Num(n) {
  Term.call(this);
  this.n = n;
}
util.inherits(Num, Term);
function Var(name) {
  Term.call(this);
  this.name = name;
  this.value = null;
  this.id = ++Var.count;
}
util.inherits(Var, Term);
Var.count = 0;
function Struct(name, args) {
  Term.call(this);
  this.name = name;
  this.args = args;
}
util.inherits(Struct, Term);
var NIL = Atom.of('[]'), TRUE = Atom.of('true');
function deref(t) {
  while (t instanceof Var && t.value !== null) t = t.value;
  return t;
}
function list(items, tail) {
  return items.reduceRight(function (rest, x) {
    return new Struct('.', [x, rest]);
}, tail || NIL);
}
function items(t) {
  var out = [];
  for (t = deref(t); t instanceof Struct && t.name === '.' &&
    t.args.length === 2; t = deref(t.args[1])) out.push(t.args[0]);
  if (t !== NIL) throw new LogicError('not a list: ' + show(t));
  return out;
}
function LogicError(message) {
  this.message = message;
}
util.inherits(LogicError, Error);
LogicError.prototype.name = 'LogicError';
var INFIX = {
  ':-': 1200, ',': 1000, ';': 1100, '->': 1050, '=': 700, '\\=': 700, '==': 700, 'is': 700,
    '<': 700, '>': 700, '=<': 700, '>=': 700, '=:=': 700, '+': 500, '-': 500, '*': 400,
    '/': 400, 'mod': 400
};
function show(t, up) {
  t = deref(t);
  if (t instanceof Num) return String(t.n);
  if (t instanceof Atom) return /^[a-z]\w*$|^\[\]$|^[^\w\s]+$/.test(t.name) ? t.name : "'" + t.name + "'";
  if (t instanceof Var) return '_' + t.name;
  if (t.name === '.' && t.args.length === 2) {
    var out = '[' + show(t.args[0], 999), at = deref(t.args[1]);
    while (at instanceof Struct && at.name === '.' && at.args.length === 2) {
      out += ',' + show(at.args[0], 999);
      at = deref(at.args[1]);
    }
    return out + (at === NIL ? ']' : '|' + show(at, 999) + ']');
  }
  var p = INFIX[t.name];
  if (p && t.args.length === 2) {
    var s = show(t.args[0],
      p) + (/\w/.test(t.name) ? ' ' + t.name + ' ' : t.name) + show(t.args[1], p - 1);
    return p > (up || 1200) ? '(' + s + ')' : s;
  }
  return show(Atom.of(t.name)) + '(' + t.args.map(function (a) {
    return show(a, 999);
}).join(',') + ')';
}
function Reader(text) {
  this.tokens = [];
  var re = /\s+|%[^\n]*|(\d+(?:\.\d+)?)|([A-Z_]\w*)|([a-z]\w*|'[^']*'|\[\]|!)|(:-|->|\\\+|\\=|==|=<|>=|=:=|[-+*\/<>=;])|([()\[\]|,.])/gy,
    m;
  while (re.lastIndex < text.length) {
    var at = re.lastIndex;
    m = re.exec(text);
    if (!m) throw new LogicError('cannot read ' + JSON.stringify(text.slice(at, at + 10)));
    for (var i = 1; i < m.length; i++) if (m[i] !== undefined) this.tokens.push([i, m[i]]);
  }
  this.i = 0;
  this.vars = null;
}
Reader.prototype.peek = function () {
  return this.i < this.tokens.length ? this.tokens[this.i][1] : null;
};
Reader.prototype.take = function (t) {
  if (this.peek() === t) {
    this.i++;
    return true;
  }
  return false;
};
Reader.prototype.need = function (t) {
  if (!this.take(t)) throw new LogicError('expected ' + t + ', got ' + this.peek());
};
Reader.prototype.clause = function () {
  if (this.i >= this.tokens.length) return null;
  this.vars = new Map();
  var t = this.term(1200);
  this.need('.');
  return {
    term: t, vars: this.vars
};
};
Reader.prototype.term = function (max) {
  var left = this.primary();
  for (;;) {
    var op = this.peek(), p = op === null ? undefined : INFIX[op];
    if (p === undefined || p > max || (op === ',' && max < 1000)) return left;
    this.i++;
    var right = this.term(op === ',' || op === ';' || op === '->' ? p : p - 1);
    left = new Struct(op, [left, right]);
  }
};
Reader.prototype.primary = function () {
  var t = this.tokens[this.i++];
  if (!t) throw new LogicError('text ends');
  switch (t[0]) {
    case 1: return new Num(+t[1]);
    case 2: {
      if (t[1] === '_') return new Var('_');
      var v = this.vars.get(t[1]);
      if (!v) this.vars.set(t[1], (v = new Var(t[1])));
      return v;
    }
    case 3: {
      var name = t[1][0] === "'" ? t[1].slice(1, -1) : t[1];
      if (t[1] !== '[]' && this.take('(')) {
        var args = [this.term(999)];
        while (this.take(',')) args.push(this.term(999));
        this.need(')');
        return new Struct(name, args);
      }
      return Atom.of(name);
    }
    case 4: if (t[1] === '-' ) {
      var n = this.primary();
      return n instanceof Num ? new Num(-n.n) : new Struct('-', [new Num(0), n]);
    }
    if (t[1] === '\\+') return new Struct('\\+', [this.term(900)]);
    break;
    case 5: if (t[1] === '(') {
      var e = this.term(1200);
      this.need(')');
      return e;
    }
    if (t[1] === '[') {
      var xs = [this.term(999)], tail = null;
      while (this.take(',')) xs.push(this.term(999));
      if (this.take('|')) tail = this.term(999);
      this.need(']');
      return list(xs, tail);
    }
  }
  throw new LogicError('unexpected ' + t[1]);
};
function Machine() {
  this.clauses = new Map();
  this.trail = [];
  this.calls = 0;
  this.unifications = 0;
  this.out = [];
  this.builtins = new Map();
  this.limit = 3e6;
  installBuiltins(this);
}
Machine.prototype.key = function (t) {
  if (t instanceof Atom) return t.name + '/0';
  if (t instanceof Struct) return t.name + '/' + t.args.length;
  throw new LogicError('not callable: ' + show(t));
};
Machine.prototype.add = function (t, first) {
  var head = t, body = TRUE;
  if (t instanceof Struct && t.name === ':-' && t.args.length === 2) {
    head = deref(t.args[0]);
    body = t.args[1];
  }
  var k = this.key(head);
  if (this.builtins.has(k)) throw new LogicError('cannot change ' + k);
  var l = this.clauses.get(k);
  if (!l) this.clauses.set(k, (l = []));
  var c = {
    head: head, body: body, gone: false
};
  this.clauses.set(k, first ? [c].concat(l) : l.concat([c]));
  return c;
};
Machine.prototype.consult = function (text) {
  var r = new Reader(text), n = 0;
  for (var c = r.clause(); c; c = r.clause()) {
    this.add(c.term);
    n++;
  }
  return n;
};
Machine.prototype.bind = function (v, t) {
  v.value = t;
  this.trail.push(v);
};
Machine.prototype.undo = function (mark) {
  while (this.trail.length > mark) this.trail.pop().value = null;
};
Machine.prototype.unify = function (a, b) {
  var stack = [a, b];
  while (stack.length) {
    b = deref(stack.pop());
    a = deref(stack.pop());
    this.unifications++;
    if (a === b) continue;
    if (a instanceof Var) {
      this.bind(a, b);
      continue;
    }
    if (b instanceof Var) {
      this.bind(b, a);
      continue;
    }
    if (a instanceof Num && b instanceof Num) {
      if (a.n !== b.n) return false;
      continue;
    }
    if (a instanceof Struct && b instanceof Struct && a.name === b.name &&
      a.args.length === b.args.length) {
      for (var i = a.args.length - 1; i >= 0; i--) stack.push(a.args[i], b.args[i]);
      continue;
    }
    return false;
  }
  return true;
};
function rename(t, map) {
  t = deref(t);
  if (t instanceof Var) {
    var v = map.get(t);
    if (!v) map.set(t, (v = new Var(t.name)));
    return v;
  }
  if (t instanceof Struct) return new Struct(t.name, t.args.map(function (a) {
    return rename(a, map);
}));
  return t;
}
function resolve(t) {
  t = deref(t);
  return t instanceof Struct ? new Struct(t.name, t.args.map(resolve)) : t;
}
function Frame(goal, next, cut) {
  this.goal = goal;
  this.next = next;
  this.cut = cut;
}
Machine.prototype.solve = function* (goal, depth) {
  var self = this, frame = new Frame(goal, null, 0), choices = [];
  function retry() {
    for (;;) {
      var c = choices[choices.length - 1];
      if (!c) return false;
      self.undo(c.mark);
      if (c.gen) {
        var r = c.gen.next();
        if (r.done) {
          choices.pop();
          continue;
        }
        frame = c.next;
        return true;
    } while (c.i < c.list.length && c.list[c.i].gone) c.i++;
      if (c.i >= c.list.length) {
        choices.pop();
        continue;
      }
      var clause = c.list[c.i++];
      var level = choices.length - 1;
      if (c.i >= c.list.length) choices.pop();
      var map = new Map(), head = rename(clause.head, map);
      if (!self.unify(c.goal, head)) {
        if (choices[choices.length - 1] !== c) {
          self.undo(c.mark);
          continue;
        }
        continue;
      }
      frame = clause.body === TRUE ? c.next : new Frame(rename(clause.body, map), c.next,
        level);
      return true;
    }
  }
  for (;;) {
    if (frame === null) {
      yield true;
      if (!retry()) return;
      continue;
    }
    var g = deref(frame.goal), next = frame.next, cut = frame.cut;
    if (++this.calls > this.limit) throw new LogicError('too many calls');
    if (g instanceof Var) throw new LogicError('a variable is called');
    var name = g.name, n = g instanceof Struct ? g.args.length : 0;
    if (name === ',' && n === 2) {
      frame = new Frame(g.args[0], new Frame(g.args[1], next, cut), cut);
      continue;
    }
    if (name === 'true' && n === 0) {
      frame = next;
      continue;
    }
    if (name === '!' && n === 0) {
      choices.length = cut;
      frame = next;
      continue;
    }
    if (name === ';' && n === 2) {
      var l = deref(g.args[0]);
      if (l instanceof Struct && l.name === '->' && l.args.length === 2) {
        var mark0 = this.trail.length, hit = !this.solve(l.args[0], (depth ||
          0) + 1).next().done;
        if (!hit) this.undo(mark0);
        frame = new Frame(hit ? l.args[1] : g.args[1], next, cut);
        continue;
      }
      choices.push({ mark: this.trail.length, list: [0], i: 0, gen: (function* (b) {
        yield b;
    })(g.args[1]), next: new Frame(g.args[1], next, cut) });
      frame = new Frame(l, next, cut);
      continue;
    }
    if (name === '->' && n === 2) {
      if (this.solve(g.args[0], (depth || 0) + 1).next().done) {
        if (!retry()) return;
        continue;
      }
      frame = new Frame(g.args[1], next, cut);
      continue;
    }
    if (name === '\\+' && n === 1) {
      var mark1 = this.trail.length, found = !this.solve(g.args[0], (depth ||
        0) + 1).next().done;
      this.undo(mark1);
      if (found) {
        if (!retry()) return;
    } else frame = next;
      continue;
    }
    if (name === 'call' && n >= 1) {
      var h = deref(g.args[0]);
      frame = new Frame(n === 1 ? h : new Struct(h.name, (h.args ||
        []).concat(g.args.slice(1))), next, choices.length);
      continue;
    }
    var key = this.key(g), b = this.builtins.get(key);
    if (b) {
      var mark = this.trail.length, r = b.apply(this, n ? g.args : []);
      if (r === true) {
        frame = next;
        continue;
      }
      if (r && typeof r.next === 'function') {
        choices.push({ mark: mark, gen: r, next: next });
        if (!retry()) return;
        continue;
      }
      this.undo(mark);
      if (!retry()) return;
      continue;
    }
    var clauses = this.clauses.get(key);
    if (!clauses) throw new LogicError('unknown ' + key);
    choices.push({ mark: this.trail.length, list: clauses, i: 0, goal: g, next: next });
    if (!retry()) return;
  }
};
Machine.prototype.value = function (t) {
  t = deref(t);
  if (t instanceof Num) return t.n;
  if (t instanceof Struct && t.args.length === 2) {
    var a = this.value(t.args[0]), b = this.value(t.args[1]);
    switch (t.name) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw new LogicError('division by zero');
      return a / b;
      case 'mod': return ((a % b) + b) % b;
    }
  }
  throw new LogicError('not a number: ' + show(t));
};
function installBuiltins(m) {
  function def(key, f) {
    m.builtins.set(key, f);
  }
  function compare(op) {
    return function (a, b) {
      return op(this.value(a), this.value(b));
  };
  }
  def('=/2', function (a, b) {
    return this.unify(a, b);
});
  def('\\=/2', function (a, b) {
    var mark = this.trail.length, r = this.unify(a, b);
    this.undo(mark);
    return !r;
});
  def('==/2', function (a, b) {
    return show(a) === show(b);
});
  def('is/2', function (a, b) {
    return this.unify(a, new Num(this.value(b)));
});
  def('</2', compare(function (a, b) {
    return a < b;
}));
  def('>/2', compare(function (a, b) {
    return a > b;
}));
  def('=</2', compare(function (a, b) {
    return a <= b;
}));
  def('>=/2', compare(function (a, b) {
    return a >= b;
}));
  def('=:=/2', compare(function (a, b) {
    return a === b;
}));
  def('fail/0', function () {
    return false;
});
  def('write/1', function (t) {
    this.out.push(show(t));
    return true;
});
  def('atom/1', function (t) {
    return deref(t) instanceof Atom;
});
  def('number/1', function (t) {
    return deref(t) instanceof Num;
});
  def('var/1', function (t) {
    return deref(t) instanceof Var;
});
  def('assertz/1', function (t) {
    this.add(rename(resolve(t), new Map()));
    return true;
});
  def('asserta/1', function (t) {
    this.add(rename(resolve(t), new Map()), true);
    return true;
});
  def('retract/1', function (t) {
    t = deref(t);
    var l = this.clauses.get(this.key(t)) || [];
    for (var i = 0; i < l.length; i++) {
      var mark = this.trail.length;
      if (!l[i].gone && l[i].body === TRUE && this.unify(t, rename(l[i].head, new Map()))) {
        l[i].gone = true;
        this.clauses.set(this.key(t), l.filter(function (c) {
          return !c.gone;
      }));
        return true;
      }
      this.undo(mark);
    }
    return false;
});
  def('between/3', function (a, b, x) {
    var self = this;
    return (function* () {
      for (var i = self.value(a), to = self.value(b); i <= to; i++) {
        var mark = self.trail.length;
        if (self.unify(x, new Num(i))) yield i;
        self.undo(mark);
      }
  })();
});
  def('findall/3', function (t, g, l) {
    var out = [], mark = this.trail.length;
    for (var _ of this.solve(g)) out.push(rename(resolve(t), new Map()));
    this.undo(mark);
    return this.unify(l, list(out));
});
  def('length/2', function (l, n) {
    return this.unify(n, new Num(items(l).length));
});
  def('sort/2', function (a, b) {
    var seen = new Set();
    return this.unify(b, list(items(a).map(resolve).filter(function (t) {
      var s = show(t);
      return seen.has(s) ? false : (seen.add(s), true);
  }).sort(function (x, y) {
      if (x instanceof Num && y instanceof Num) return x.n - y.n;
      var p = show(x), q = show(y);
      return p < q ? -1 : 1;
  })));
});
  def('=../2', function (t, l) {
    t = deref(t);
    return this.unify(l, list([Atom.of(t.name)].concat(t.args || [])));
});
}
Machine.prototype.query = function (text, limit) {
  var c = new Reader(text + '.').clause(), out = [], mark = this.trail.length;
  try {
    for (var _ of this.solve(c.term)) {
      out.push([...c.vars].filter(function (p) {
        return p[0][0] !== '_';
    }).map(function (p) {
        return p[0] + '=' + show(p[1]);
    }).join(' ') || 'yes');
      if (out.length >= (limit || Infinity)) break;
    }
} finally {
    this.undo(mark);
  }
  return out;
};
var world = "parent(tom, bob). parent(tom, liz). parent(bob, ann). parent(bob, pat). parent(pat, jim). male(tom). male(bob). male(jim). grand(X, Z) :- parent(X, Y), parent(Y, Z). ancestor(X, Y) :- parent(X, Y). ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y). append([], L, L). append([H|T], L, [H|R]) :- append(T, L, R). member(X, [X|_]). member(X, [_|T]) :- member(X, T). reverse(L, R) :- rev(L, [], R). rev([], A, A). rev([H|T], A, R) :- rev(T, [H|A], R). select(X, [X|T], T). select(X, [H|T], [H|R]) :- select(X, T, R). perm([], []). perm(L, [H|T]) :- select(H, L, R), perm(R, T). max(X, Y, X) :- X >= Y, !. max(_, Y, Y). fact(0, 1) :- !. fact(N, F) :- N > 0, M is N - 1, fact(M, G), F is N * G. safe([]). safe([Q|Qs]) :- no(Q, 1, Qs), safe(Qs). no(_, _, []). no(Q, D, [P|Ps]) :- Q =\\= P. color(red). color(green). color(blue). count(N, N) :- !. count(A, N) :- A < N, B is A + 1, count(B, N). sumto(0, 0) :- !. sumto(N, S) :- M is N - 1, sumto(M, T), S is T + N. hanoi(0, _, _, _, 0) :- !. hanoi(N, A, B, C, M) :- K is N - 1, hanoi(K, A, C, B, X), hanoi(K, C, B, A, Y), M is X + Y + 1. ".replace(/no\(_, _, \[\]\)\. no\(Q, D, \[P\|Ps\]\) :- Q =\\= P\. /,
  'no(_, _, []). no(Q, D, [P|Ps]) :- A is Q + D, \\+ (A =:= P), B is Q - D, \\+ (B =:= P), E is D + 1, no(Q, E, Ps). ') + "queens(L, Q) :- perm(L, Q), safe(Q). map([A, B, C, D, E]) :- color(A), color(B), A \\= B, color(C), C \\= A, C \\= B, color(D), D \\= B, D \\= C, color(E), E \\= A, E \\= C, E \\= D. kind(X, K) :- ( number(X) -> K = number ; atom(X) -> K = atom ; K = other ). ";
var m = new Machine();
console.log(m.consult(world));
var queries = [['grand(tom, X)'], ['ancestor(X, jim)'], ['ancestor(tom, X), male(X)'],
  ['append(X, Y, [1, 2, 3])'], ['member(X, [a, B, c]), atom(X)', 5],
  ['reverse([1, 2, [3, x]], R)'], ['perm([1, 2, 3], P)'], ['max(3, 7, M)'], ['fact(12, F)'],
  ['queens([1, 2, 3, 4, 5, 6], Q)', 2], ['queens([1, 2, 3, 4, 5, 6, 7], Q)', 1], ['map(M)', 3],
  ['kind(5, A), kind(x, B), kind(f(x), C)'],
  ['findall(X-Y, (member(X, [1, 2]), member(Y, [a, b])), L), length(L, N)'],
  ['between(1, 20, X), 0 is X mod 7'], ['\\+ parent(jim, _)'], ['X = f(Y, Z), Y = 1, X =.. L'],
  ['assertz(fresh(1)), assertz(fresh(2)), fresh(X)'], ['retract(fresh(1)), fresh(X)'],
  ['sort([3, 1, 2, 1, b, a], L)'], ['count(0, 300)'], ['sumto(150, S)'],
  ['hanoi(9, a, b, c, N)'], ['(X = 1 ; X = 2 ; X = 3), X > 1'], ['call(append, [1], [2], L)'],
  ['X is 7 / 2 - 3 * (4 - 1) mod 5'], ['fail'], ['unknown(1)'], ['X is a + 1'], ['X is 1 / 0'],
  ['foo('], ['X'], ['length([1|T], N)'],
  ['write(hello), write(f(X, [1|T])), fail ; write(end)']];
for (var round = 0; round < 6; round++) queries.forEach(function (q, i) {
  var text;
  try {
    var r = m.query(q[0], q[1]);
    text = r.length + ' ' + r.slice(0, 6).join(' | ');
} catch (e) {
    text = e.name + ' ' + e.message;
  }
  if (round === 0 || (round === 5 && i % 11 === 0)) console.log(q[0], '=>',
    text.replace(/_[A-Z]\w*|__/g, '_v'));
  m.trail.length = 0;
});
console.log(m.calls, m.unifications, m.out.length, m.out.slice(0,
  3).join(' ').replace(/_[A-Z]\w*|__/g, '_v'), Var.count > 100000,
  Object.keys(Atom.all).length);
