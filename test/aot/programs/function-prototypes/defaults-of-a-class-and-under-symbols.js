// The same idiom on a class, under a symbol, and below a class that declares an accessor of the name.
const log = [];
const kState = Symbol("kState");
class Stream {
  constructor() { this[kState] = 1; this.flowing = true; }
  get mode() { return "stream mode"; }
  set mode(v) { log.push("stream set mode " + v); }
}
Stream.prototype[kState] = 0;
Stream.prototype.flowing = null;
class Socket extends Stream {
  constructor(mode) { super(); this.mode = mode; this.open = true; }
}
Socket.prototype.open = false;
let s;
for (let i = 0; i < 3; i++) s = new Socket("m" + i);
log.push(Reflect.ownKeys(s).map(String).join(), s.mode, s[kState], s.flowing, s.open);
Object.defineProperty(Socket.prototype, "mode", { value: "plain", writable: true, configurable: true, enumerable: true });
for (let i = 0; i < 40; i++) s = new Socket("n" + i);
log.push(Reflect.ownKeys(s).map(String).join(), s.mode);
Object.defineProperty(Stream.prototype, kState, { set(v) { log.push("set state " + v); }, configurable: true });
s = new Socket("o");
log.push(Reflect.ownKeys(s).map(String).join(), String(s[kState]));
console.log(log.join(" | "));
