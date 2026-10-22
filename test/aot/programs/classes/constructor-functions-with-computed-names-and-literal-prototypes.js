// Chains of constructor functions as node's streams have them: members under computed names, a prototype object that is a literal, a parent that is never constructed by itself.
// After hot calls each kind of change must show: another function under a name, a name added in the middle of the chain, a name deleted, a link changed.
const kHidden = Symbol("hidden");
const computed = "comp" + "uted";
function Emitter() { this.count = 0; }
Emitter.prototype.on = function on() { return "Emitter.on"; };
Emitter.prototype.emit = function emit() { return "Emitter.emit"; };
Emitter.prototype[kHidden] = function hidden() { return "Emitter.hidden"; };
Emitter.prototype[computed] = function () { return "Emitter.computed"; };
function Stream() { Emitter.call(this); }
Object.setPrototypeOf(Stream.prototype, Emitter.prototype);
Stream.prototype.pipe = function pipe() { return "Stream.pipe"; };
function Readable() { Stream.call(this); this.flowing = null; }
Object.setPrototypeOf(Readable.prototype, Stream.prototype);
Readable.prototype.read = function read() { return "Readable.read"; };
Readable.prototype.on = function on() { return "Readable.on+" + Stream.prototype.on.call(this); };
Readable.prototype[Symbol.asyncIterator] = function () { return "Readable.iterator"; };
function Socket() { Readable.call(this); }
Object.setPrototypeOf(Socket.prototype, Readable.prototype);
Socket.prototype.connect = function connect() { return "Socket.connect"; };
function Literal() { this.x = 1; }
Literal.prototype = { constructor: Literal, first() { return "Literal.first"; }, second() { return "Literal.second"; } };
function BelowLiteral() { Literal.call(this); }
BelowLiteral.prototype = Object.create(Literal.prototype, { constructor: { value: BelowLiteral, writable: true, configurable: true } });
BelowLiteral.prototype.third = function third() { return "BelowLiteral.third"; };
function use(s) { return [s.on(), s.emit(), s.pipe(), s.read(), s.connect(), s.computed(), s[kHidden](), s[Symbol.asyncIterator]()].join(" "); }
function useLiteral(b) { return [b.first(), b.second(), b.third(), b.constructor.name].join(" "); }
function hot() {
  let last = "";
  for (let i = 0; i < 3000; i++) last = use(new Socket()) + " | " + useLiteral(new BelowLiteral());
  return last;
}
console.log(hot());
Emitter.prototype.emit = function () { return "emit changed"; };
console.log(hot());
Stream.prototype.emit = function () { return "emit added in the middle"; };
console.log(hot());
delete Stream.prototype.emit;
delete Readable.prototype.on;
console.log(hot());
Literal.prototype.second = function () { return "second changed"; };
BelowLiteral.prototype.first = function () { return "first shadowed"; };
console.log(hot());
Emitter.prototype[computed] = function () { return "computed changed"; };
Socket.prototype["re" + "ad"] = function () { return "read shadowed under a computed name"; };
console.log(hot());
Object.setPrototypeOf(Readable.prototype, { pipe() { return "other pipe"; }, emit() { return "other emit"; }, on() { return "other on"; }, computed() { return "other computed"; }, [kHidden]() { return "other hidden"; } });
console.log(hot());
console.log(use(new Socket()), new Readable().read(), new Stream().pipe(), new Emitter().on(), new Literal().first());
function Late() { Socket.call(this); }
Object.setPrototypeOf(Late.prototype, Socket.prototype);
Late.prototype.connect = function () { return "Late.connect"; };
console.log(use(new Late()));
