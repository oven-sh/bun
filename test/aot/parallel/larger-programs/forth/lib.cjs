// A Forth: words, a dictionary that is searched backward, compiled definitions, loops, variables, strings, a return stack, errors with the word they came from
'use strict';
function ForthError(message, word) {
  this.message = message + (word ? ' in ' + word : '');
  this.word = word;
  this.stack = new Error(message).stack;
}
ForthError.prototype = Object.create(Error.prototype, { constructor: { value: ForthError },
  name: { value: 'ForthError' } });
function Stack(limit, name) {
  this.items = [];
  this.limit = limit;
  this.name = name;
  this.deepest = 0;
}
Stack.prototype.push = function (v) {
  if (this.items.length >= this.limit) throw new ForthError(this.name + ' overflows');
  this.items.push(v);
  if (this.items.length > this.deepest) this.deepest = this.items.length;
};
Stack.prototype.pop = function () {
  if (!this.items.length) throw new ForthError(this.name + ' is empty');
  return this.items.pop();
};
Stack.prototype.peek = function (n) {
  var i = this.items.length - 1 - (n || 0);
  if (i < 0) throw new ForthError(this.name + ' is empty');
  return this.items[i];
};
Stack.prototype.roll = function (n) {
  var i = this.items.length - 1 - n;
  if (i < 0) throw new ForthError(this.name + ' is empty');
  this.items.push(this.items.splice(i, 1)[0]);
};
function Word(name, run, immediate) {
  this.name = name;
  this.run = run;
  this.immediate = !!immediate;
  this.uses = 0;
  this.code = null;
  this.hidden = false;
}
function Dictionary() {
  this.words = [];
  this.looks = 0;
}
Dictionary.prototype.add = function (w) {
  this.words.push(w);
  return w;
};
Dictionary.prototype.find = function (name) {
  var n = name.toLowerCase();
  for (var i = this.words.length - 1; i >= 0; i--) {
    this.looks++;
    if (!this.words[i].hidden && this.words[i].name === n) return this.words[i];
  }
  return null;
};
Dictionary.prototype.forget = function (name) {
  for (var i = this.words.length - 1; i >= 0; i--) if (this.words[i].name === name) {
    this.words.length = i;
    return true;
  }
  return false;
};
var CELL = {
  LIT: 0, CALL: 1, BRANCH: 2, ZBRANCH: 3, EXIT: 4, DO: 5, LOOP: 6, PLOOP: 7, STRING: 8, I: 9,
    J: 10, TO: 11
};
function Forth() {
  this.data = new Stack(1024, 'stack');
  this.returns = new Stack(512, 'return stack');
  this.dictionary = new Dictionary();
  this.memory = [];
  this.out = '';
  this.compiling = null;
  this.control = [];
  this.source = '';
  this.at = 0;
  this.steps = 0;
  this.limit = 5e7;
  this.depth = 0;
  this.base = 10;
  install(this);
}
Forth.prototype.word = function (until) {
  var s = this.source;
  if (until) {
    var end = s.indexOf(until, this.at);
    if (end < 0) throw new ForthError('no closing ' + until);
    var text = s.slice(this.at, end);
    this.at = end + 1;
    return text;
} while (this.at < s.length && /\s/.test(s[this.at])) this.at++;
  var from = this.at;
  while (this.at < s.length && !/\s/.test(s[this.at])) this.at++;
  var w = s.slice(from, this.at);
  if (this.at < s.length) this.at++;
  return w;
};
Forth.prototype.number = function (text) {
  var t = text, neg = t[0] === '-';
  if (neg) t = t.slice(1);
  if (!t) return null;
  var base = this.base;
  if (t[0] === '$') {
    base = 16;
    t = t.slice(1);
} else if (t[0] === '%') {
    base = 2;
    t = t.slice(1);
  }
  var n = 0;
  for (var i = 0; i < t.length; i++) {
    var d = parseInt(t[i], 36);
    if (!(d < base)) return /^\d+\.\d+$/.test(text.replace('-', '')) ? +text : null;
    n = n * base + d;
  }
  return t ? (neg ? -n : n) : null;
};
Forth.prototype.emit = function () {
  for (var i = 0; i < arguments.length; i++) this.compiling.code.push(arguments[i]);
  return this.compiling.code.length - 1;
};
Forth.prototype.interpret = function (source) {
  var before = {
    source: this.source, at: this.at
};
  this.source = source;
  this.at = 0;
  try {
    for (var t = this.word(); t !== ''; t = this.word()) {
      var w = this.dictionary.find(t);
      if (w) {
        if (this.compiling && !w.immediate) this.emit(CELL.CALL, w);
        else this.execute(w);
        continue;
      }
      var n = this.number(t);
      if (n === null) throw new ForthError('unknown word ' + t);
      if (this.compiling) this.emit(CELL.LIT, n);
      else this.data.push(n);
    }
} catch (e) {
    this.compiling = null;
    this.control.length = 0;
    throw e;
} finally {
    this.source = before.source;
    this.at = before.at;
  }
  return this;
};
Forth.prototype.execute = function (w) {
  w.uses++;
  if (w.code === null) {
    try {
      w.run.call(this, this.data);
  } catch (e) {
      if (e instanceof ForthError && !e.word) throw new ForthError(e.message, w.name);
      throw e;
    }
    return;
  }
  if (++this.depth > 400) {
    this.depth = 0;
    throw new ForthError('too deep', w.name);
  }
  this.run(w);
  this.depth--;
};
Forth.prototype.run = function (w) {
  var code = w.code, pc = 0, loops = [], d = this.data;
  for (;;) {
    if (++this.steps > this.limit) throw new ForthError('too many steps', w.name);
    switch (code[pc++]) {
      case CELL.LIT: d.push(code[pc++]);
      break;
      case CELL.CALL: this.execute(code[pc++]);
      break;
      case CELL.BRANCH: pc = code[pc];
      break;
      case CELL.ZBRANCH: pc = d.pop() === 0 ? code[pc] : pc + 1;
      break;
      case CELL.DO: {
        var from = d.pop(), to = d.pop();
        loops.push({ i: from, to: to });
        break;
      }
      case CELL.LOOP: {
        var l = loops[loops.length - 1];
        if (++l.i < l.to) pc = code[pc];
        else {
          loops.pop();
          pc++;
        }
        break;
      }
      case CELL.PLOOP: {
        var p = loops[loops.length - 1], by = d.pop();
        p.i += by;
        if (by >= 0 ? p.i < p.to : p.i >= p.to) pc = code[pc];
        else {
          loops.pop();
          pc++;
        }
        break;
      }
      case CELL.I: d.push(loops[loops.length - 1].i);
      break;
      case CELL.J: d.push(loops[loops.length - 2].i);
      break;
      case CELL.STRING: this.out += code[pc++];
      break;
      case CELL.TO: this.memory[code[pc++]] = d.pop();
      break;
      case CELL.EXIT: return;
      default: throw new ForthError('bad code', w.name);
    }
  }
};
Forth.prototype.allot = function (n) {
  var at = this.memory.length;
  for (var i = 0; i < n; i++) this.memory.push(0);
  return at;
};
Forth.prototype.address = function (a) {
  if (!Number.isInteger(a) || a < 0 ||
    a >= this.memory.length) throw new ForthError('bad address ' + a);
  return a;
};
function install(f) {
  function def(name, run, immediate) {
    f.dictionary.add(new Word(name, run, immediate));
  }
  function binary(name, op) {
    def(name, function (d) {
      var b = d.pop(), a = d.pop();
      d.push(op(a, b));
  });
  }
  function flag(v) {
    return v ? -1 : 0;
  }
  [['+', function (a, b) {
    return a + b;
}], ['-', function (a, b) {
    return a - b;
}], ['*', function (a, b) {
    return a * b;
}], ['/', function (a, b) {
    if (b === 0) throw new ForthError('division by zero');
    return Math.floor(a / b);
}], ['mod', function (a, b) {
    if (b === 0) throw new ForthError('division by zero');
    return ((a % b) + b) % b;
}], ['=', function (a, b) {
    return flag(a === b);
}], ['<>', function (a, b) {
    return flag(a !== b);
}], ['<', function (a, b) {
    return flag(a < b);
}], ['>', function (a, b) {
    return flag(a > b);
}], ['and', function (a, b) {
    return a & b;
}], ['or', function (a, b) {
    return a | b;
}], ['xor', function (a, b) {
    return a ^ b;
}], ['lshift', function (a, b) {
    return a << b;
}], ['min', Math.min], ['max', Math.max]].forEach(function (p) {
    binary(p[0], p[1]);
});
  def('dup', function (d) {
    d.push(d.peek());
});
  def('drop', function (d) {
    d.pop();
});
  def('swap', function (d) {
    d.roll(1);
});
  def('over', function (d) {
    d.push(d.peek(1));
});
  def('rot', function (d) {
    d.roll(2);
});
  def('nip', function (d) {
    var a = d.pop();
    d.pop();
    d.push(a);
});
  def('2dup', function (d) {
    d.push(d.peek(1));
    d.push(d.peek(1));
});
  def('2drop', function (d) {
    d.pop();
    d.pop();
});
  def('pick', function (d) {
    d.push(d.peek(d.pop()));
});
  def('depth', function (d) {
    d.push(d.items.length);
});
  def('?dup', function (d) {
    if (d.peek() !== 0) d.push(d.peek());
});
  def('0=', function (d) {
    d.push(flag(d.pop() === 0));
});
  def('negate', function (d) {
    d.push(-d.pop());
});
  def('abs', function (d) {
    d.push(Math.abs(d.pop()));
});
  def('1+', function (d) {
    d.push(d.pop() + 1);
});
  def('>r', function (d) {
    this.returns.push(d.pop());
});
  def('r>', function (d) {
    d.push(this.returns.pop());
});
  def('r@', function (d) {
    d.push(this.returns.peek());
});
  def('.', function (d) {
    this.out += d.pop().toString(this.base) + ' ';
});
  def('cr', function () {
    this.out += '\n';
});
  def('emit', function (d) {
    this.out += String.fromCharCode(d.pop());
});
  def('.s', function (d) {
    this.out += '<' + d.items.length + '> ' + d.items.join(' ') + ' ';
});
  def('hex', function () {
    this.base = 16;
});
  def('decimal', function () {
    this.base = 10;
});
  def('words', function () {
    this.out += this.dictionary.words.length + ' ';
});
  def('@', function (d) {
    d.push(this.memory[this.address(d.pop())]);
});
  def('!', function (d) {
    var a = this.address(d.pop());
    this.memory[a] = d.pop();
});
  def('+!', function (d) {
    var a = this.address(d.pop());
    this.memory[a] += d.pop();
});
  def('here', function (d) {
    d.push(this.memory.length);
});
  def('allot', function (d) {
    this.allot(d.pop());
});
  def(',', function (d) {
    this.memory[this.allot(1)] = d.pop();
});
  def('cells', function () {
});
  def('variable', function () {
    var a = this.allot(1);
    this.dictionary.add(new Word(this.word().toLowerCase(), function (d) {
      d.push(a);
  }));
});
  def('constant', function (d) {
    var v = d.pop();
    this.dictionary.add(new Word(this.word().toLowerCase(), function (s) {
      s.push(v);
  }));
});
  def('create', function () {
    var a = this.memory.length;
    this.dictionary.add(new Word(this.word().toLowerCase(), function (d) {
      d.push(a);
  }));
});
  def('forget', function () {
    var n = this.word().toLowerCase();
    if (!this.dictionary.forget(n)) throw new ForthError('cannot forget ' + n);
});
  def(':', function () {
    if (this.compiling) throw new ForthError('already compiling');
    var w = new Word(this.word().toLowerCase(), null);
    w.code = [];
    w.hidden = true;
    this.compiling = this.dictionary.add(w);
});
  def(';', function () {
    if (!this.compiling || this.control.length) throw new ForthError('unbalanced');
    this.emit(CELL.EXIT);
    this.compiling.hidden = false;
    this.compiling = null;
}, true);
  def('recurse', function () {
    this.emit(CELL.CALL, this.compiling);
}, true);
  def('immediate', function () {
    this.dictionary.words[this.dictionary.words.length - 1].immediate = true;
});
  def('exit', function () {
    this.emit(CELL.EXIT);
}, true);
  def('if', function () {
    this.control.push(this.emit(CELL.ZBRANCH, 0));
}, true);
  def('else', function () {
    var from = this.control.pop();
    this.control.push(this.emit(CELL.BRANCH, 0));
    this.compiling.code[from] = this.compiling.code.length;
}, true);
  def('then', function () {
    var from = this.control.pop();
    if (from === undefined) throw new ForthError('then without if');
    this.compiling.code[from] = this.compiling.code.length;
}, true);
  def('begin', function () {
    this.control.push(this.compiling.code.length);
}, true);
  def('until', function () {
    this.emit(CELL.ZBRANCH, this.control.pop());
}, true);
  def('again', function () {
    this.emit(CELL.BRANCH, this.control.pop());
}, true);
  def('while', function () {
    this.control.push(this.emit(CELL.ZBRANCH, 0));
}, true);
  def('repeat', function () {
    var out = this.control.pop(), top = this.control.pop();
    this.emit(CELL.BRANCH, top);
    this.compiling.code[out] = this.compiling.code.length;
}, true);
  def('do', function () {
    this.emit(CELL.DO);
    this.control.push(this.compiling.code.length);
}, true);
  def('loop', function () {
    this.emit(CELL.LOOP, this.control.pop());
}, true);
  def('+loop', function () {
    this.emit(CELL.PLOOP, this.control.pop());
}, true);
  def('i', function () {
    this.emit(CELL.I);
}, true);
  def('j', function () {
    this.emit(CELL.J);
}, true);
  def('."', function () {
    var t = this.word('"');
    if (this.compiling) this.emit(CELL.STRING, t);
    else this.out += t;
}, true);
  def('(', function () {
    this.word(')');
}, true);
  def("'", function (d) {
    var n = this.word(), w = this.dictionary.find(n);
    if (!w) throw new ForthError('unknown word ' + n);
    d.push(w);
});
  def('execute', function (d) {
    var w = d.pop();
    if (!(w instanceof Word)) throw new ForthError('not a word');
    this.execute(w);
});
  def('evaluate', function () {
    var t = this.word('"');
    this.interpret(t);
});
}
var library = ': square dup * ; : cube dup square * ; : 2swap >r rot rot r> rot rot ; : fact dup 1 > if dup 1 - recurse * else drop 1 then ; : fib dup 2 < if exit then dup 1 - recurse swap 2 - recurse + ; : gcd begin dup while swap over mod repeat drop ; : even 2 mod 0= ; : spaces 0 do 32 emit loop ; variable seed 7 seed ! : random seed @ 48271 * 2147483647 mod dup seed ! swap mod ; create flags 3000 allot : sieve 3000 0 do -1 flags i + ! loop 55 2 do flags i + @ if 3000 i square do 0 flags i + ! j +loop then loop 0 3000 2 do flags i + @ if 1+ then loop ; : stars 0 do 42 emit loop cr ; : triangle 1+ 1 do i stars loop ; : sum 0 swap 1+ 1 do i + loop ; : collatz 0 swap begin dup 1 > while dup even if 2 / else 3 * 1+ then swap 1+ swap repeat drop ;';
module.exports = { ForthError, Stack, Word, Dictionary, CELL, Forth, install, library };
