var defaults = { limit: 10, step: 3, loose: false, onToken: null };
function getOptions(given) {
  var options = {};
  for (var name in defaults) options[name] = given && Object.prototype.hasOwnProperty.call(given, name) ? given[name] : defaults[name];
  return options;
}
function Token(scanner) { this.type = scanner.type; this.start = scanner.start; this.end = scanner.pos; }

var Scanner = function Scanner(options) {
  this.options = getOptions(options);
  this.pos = 0;
  this.start = 0;
  this.type = 1;
  this.strict = this.isStrictAt(this.pos);
};
var accessors = { atEnd: { configurable: true }, isLoose: { configurable: true } };
accessors.atEnd.get = function () { return this.pos > this.options.limit; };
accessors.isLoose.get = function () { return this.pos > 0 || this.options.loose; };
Scanner.tokenizer = function tokenizer(options) { return new this(options); };
Object.defineProperties(Scanner.prototype, accessors);
var pp = Scanner.prototype;
pp.isStrictAt = function (at) { return at === 0; };
pp.getToken = function () {
  if (this.options.onToken) this.options.onToken(new Token(this));
  this.start = this.pos;
  this.pos += this.options.step;
  this.type = this.atEnd ? 0 : 1;
  return new Token(this);
};
pp[Symbol.iterator] = function () {
  var self = this;
  return { next: function () { var token = self.getToken(); return { done: token.type === 0, value: token }; } };
};

var sum = 0, loose = 0, seen = 0;
for (var turn = 0; turn < 50; turn++) {
  var scanner = Scanner.tokenizer(turn % 10 ? { limit: 300 } : { limit: 30, onToken: function (token) { seen += token.end; } });
  for (var token of scanner) sum += token.end - token.start;
  if (scanner.isLoose) loose++;
}
console.log(sum, loose, seen, Object.keys(Scanner.prototype).join());

function Named() { this.value = 1; }
var laterName = { first: { configurable: true } };
laterName.first.get = function () { return "first " + this.value; };
laterName.second = { get: function () { return "second " + this.value; } };
Object.defineProperties(Named.prototype, laterName);
var named = new Named();
console.log(named.first, named.second, named.third);

function Replaced() { this.value = 2; }
var replaced = { only: { configurable: true } };
replaced.only.get = function () { return "old " + this.value; };
replaced.only = { get: function () { return "new " + this.value; } };
Object.defineProperties(Replaced.prototype, replaced);
console.log(new Replaced().only);

function Grown() { this.value = 3; }
var sneaky = {
  get missing() { this.sneaked = { get: function () { return "sneaked " + this.value; } }; return undefined; },
};
var grown = { __proto__: sneaky, own: { configurable: true } };
grown.own.get = function () { return "own " + this.value; };
var nothing = grown.missing;
Object.defineProperties(Grown.prototype, grown);
var grownObject = new Grown();
console.log(grownObject.own, grownObject.sneaked, nothing);

function Left() { this.value = 4; }
function Right() { this.value = 5; }
var shared = { size: { configurable: true }, kind: { configurable: true, value: "shared" } };
shared.size.get = function () { return this.value * 2; };
Object.defineProperties(Left.prototype, shared);
shared.size.get = function () { return this.value * 3; };
Object.defineProperties(Right.prototype, shared);
console.log(new Left().size, new Right().size, new Left().kind, new Right().kind, typeof shared.toString);

function Written() { this.held = 0; }
var written = { held2: { configurable: true } };
written.held2.get = function () { return this.held; };
written.held2.set = function (value) { this.held = value + 1; };
Object.defineProperties(Written.prototype, written);
var target = new Written();
target.held2 = 6;
target.other = 7;
console.log(target.held2, target.held, target.other, Object.keys(target).join());
