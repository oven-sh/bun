import { Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
let Chosen = Readable;
function make(options) {
  return new Chosen(options);
}
const say = value => console.log(typeof value, value?.constructor?.name, value instanceof Readable, value instanceof Writable, value instanceof EventEmitter);
for (let i = 0; i < 3; i++) say(make());
for (const next of [Duplex, Transform, PassThrough, Writable, EventEmitter]) {
  Chosen = next;
  say(make());
}
class Own { constructor(a) { this.a = a; } }
Chosen = Own;
say(make(5)); console.log(make(5).a);
Chosen = function Plain(a) { this.b = a; };
say(make(6)); console.log(make(6).b);
Chosen = function Answers() { return { other: 1 }; };
console.log(JSON.stringify(make()));
Chosen = Readable.bind(null);
say(make());
Chosen = new Proxy(Readable, { construct(target, list, newTarget) { console.log("trap", list.length, newTarget === Chosen); return Reflect.construct(target, list, target); } });
say(make({}));
for (const wrong of [() => 1, null, undefined, 5, "text", {}, Symbol.iterator, async function f() {}, function* g() {}, Math.max]) {
  Chosen = wrong;
  try { say(make()); } catch (error) { console.log(error.constructor.name); }
}
Chosen = Readable;
say(make({ read() {} }));
