// Two tokenizers with the same methods. One assigns them to `F.prototype`, the other to a variable that holds `F.prototype`.
// ../equivalent-forms.test.ts holds the pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function Named(input) {
  this.input = String(input);
  this.pos = 0;
  this.type = 0;
  this.start = 0;
  this.end = 0;
  this.value = null;
}
Named.prototype.next = function () {
  this.skipSpace();
  this.start = this.pos;
  if (this.pos >= this.input.length) {
    this.pos = 0;
    return this.finishToken(0);
  }
  return this.readToken(this.codeAtPos());
};
Named.prototype.codeAtPos = function () {
  return this.input.charCodeAt(this.pos);
};
Named.prototype.skipSpace = function () {
  while (this.pos < this.input.length && this.input.charCodeAt(this.pos) === 32) ++this.pos;
};
Named.prototype.readToken = function (code) {
  if (code >= 97 && code <= 122) return this.readWord();
  ++this.pos;
  return this.finishToken(code);
};
Named.prototype.readWord = function () {
  var start = this.pos;
  while (this.pos < this.input.length) {
    var code = this.input.charCodeAt(this.pos);
    if (code < 97 || code > 122) break;
    ++this.pos;
  }
  return this.finishToken(1, this.pos - start);
};
Named.prototype.finishToken = function (type, value) {
  this.end = this.pos;
  this.type = type;
  this.value = value;
  return type;
};

function Held(input) {
  this.input = String(input);
  this.pos = 0;
  this.type = 0;
  this.start = 0;
  this.end = 0;
  this.value = null;
}
var members = Held.prototype;
members.next = function () {
  this.skipSpace();
  this.start = this.pos;
  if (this.pos >= this.input.length) {
    this.pos = 0;
    return this.finishToken(0);
  }
  return this.readToken(this.codeAtPos());
};
members.codeAtPos = function () {
  return this.input.charCodeAt(this.pos);
};
members.skipSpace = function () {
  while (this.pos < this.input.length && this.input.charCodeAt(this.pos) === 32) ++this.pos;
};
members.readToken = function (code) {
  if (code >= 97 && code <= 122) return this.readWord();
  ++this.pos;
  return this.finishToken(code);
};
members.readWord = function () {
  var start = this.pos;
  while (this.pos < this.input.length) {
    var code = this.input.charCodeAt(this.pos);
    if (code < 97 || code > 122) break;
    ++this.pos;
  }
  return this.finishToken(1, this.pos - start);
};
members.finishToken = function (type, value) {
  this.end = this.pos;
  this.type = type;
  this.value = value;
  return type;
};

const source = "let answer = first + second * (third - fourth) ; ";
const named = new Named(source);
const held = new Held(source);

const loops = {
  "methods assigned to the prototype of a function": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += named.next();
    return sum;
  },
  "methods assigned to a variable that holds the prototype": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += held.next();
    return sum;
  },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
