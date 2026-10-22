// Object.assign, a loop over names, __defineSetter__, Reflect.defineProperty, and a store through a variable that holds the prototype.
const log = [];
function Message(a, b, c, d) {
  this.a = a;
  this.b = b;
  this.c = c;
  this.d = d;
}
Object.assign(Message.prototype, { a: 1, b: 2 });
for (const name of ["c"]) Message.prototype[name] = 3;
const proto = Message.prototype;
proto.d = 4;
let m;
for (let i = 0; i < 40; i++) m = new Message(i, i, i, i);
log.push(Object.keys(m).join(), m.a + m.b + m.c + m.d);
proto.__defineSetter__("a", function (v) { log.push("set a " + v); });
Reflect.defineProperty(proto, "b", { set(v) { log.push("set b " + v); }, configurable: true });
Object.defineProperties(proto, { c: { value: 3, writable: false } });
try {
  m = new Message(5, 6, 7, 8);
  log.push(Object.keys(m).join());
} catch (e) {
  log.push(e.constructor.name);
}
Object.defineProperties(proto, { c: { value: 3, writable: true } });
m = new Message(5, 6, 7, 8);
log.push(Object.keys(m).join(), String(m.a), String(m.b), m.c, m.d);
console.log(log.join(" | "));
