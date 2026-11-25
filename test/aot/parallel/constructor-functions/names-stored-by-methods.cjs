// STATISTIC: NamesStoredByMethodsAppended >= 1
// Methods store names that the constructor does not store. The class is kept in a table beside many others: nothing is proven of its objects.
function Scanner() { this.pos = 0; this.len = 0; this.ch = -1; }
Scanner.prototype.open = function (text) { this.src = text; this.len = text.length; this.pos = 0; };
Scanner.prototype.setHandler = function (handler) { this.handler = handler; };
Scanner.prototype.peek = function () { return this.pos < this.len ? this.src.charCodeAt(this.pos) : -1; };
Scanner.prototype.next = function () { this.pos++; this.ch = this.peek(); if (this.ch === 33) this.handler(this.pos); };
var kinds = {};
function define(name, kind) { kinds[name] = kind; }
define('A', function A() { this.a = 1; });
define('B', function B() { this.b = 2; });
define('C', function C() { this.c = 3; });
define('D', function D() { this.d = 4; });
define('E', function E() { this.e = 5; });
define('F', function F() { this.f = 6; });
define('G', function G() { this.g = 7; });
define('H', function H() { this.h = 8; });
define('I', function I() { this.i = 9; });
define('Scanner', Scanner);
function make(name) { return new kinds[name](); }
function sum(text) {
  var scanner = make('Scanner'), s = 0, marks = [];
  scanner.setHandler(function (at) { marks.push(at); });
  scanner.open(text);
  scanner.ch = scanner.peek();
  while (scanner.ch !== -1) { s = (s * 31 + scanner.ch) | 0; scanner.next(); }
  return s + ' ' + marks.join();
}
console.log(sum('hello! world!'), sum(''), sum('!'));
console.log(Object.keys(kinds).map(function (name) { return Object.keys(make(name)).join(); }).join(';'));
var empty = make('Scanner');
console.log(empty.src, 'src' in empty, Object.keys(empty).join());
empty.setHandler(1);
console.log(Object.keys(empty).join(), JSON.stringify(empty));
Object.freeze(empty);
empty.open('x');
console.log(empty.src, empty.len);
var bare = { pos: 0 };
Scanner.prototype.open.call(bare, 'abc');
console.log(JSON.stringify(bare));
Object.defineProperty(Scanner.prototype, 'src', { set: function (text) { this.late = text; }, get: function () { return 'of ' + this.late; }, configurable: true });
var late = make('Scanner');
late.open('yz');
console.log(late.src, late.late, Object.keys(late).join());
