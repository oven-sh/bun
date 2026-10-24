import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

let heard = 0;
const emitter = new EventEmitter();
const listener = (n: number) => void (heard += n);
emitter.on("n", listener);

function send(target: EventEmitter, n: number): boolean {
  return target.emit("n", n);
}
function hot(target: EventEmitter): string {
  let answered = 0;
  for (let i = 0; i < 3000; i++) if (send(target, 1)) answered++;
  return answered + " " + heard + " " + target.listenerCount("n");
}

console.log(hot(emitter));

const heir = new Readable({ read() {} });
heir.on("n", listener);
console.log(hot(heir));
const other: EventEmitter = new Writable();
console.log(hot(other));
const bare: EventEmitter = Object.create(EventEmitter.prototype);
console.log(hot(bare));
bare.on("n", listener);
console.log(hot(bare));
const called = {} as EventEmitter;
Object.setPrototypeOf(called, EventEmitter.prototype);
EventEmitter.call(called);
called.once("n", listener);
console.log(hot(called));
console.log(hot(EventEmitter.prototype));

const emit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (this: EventEmitter, name: string | symbol, ...rest: unknown[]) {
  heard += 1000;
  return emit.call(this, name, ...rest);
};
console.log(hot(emitter), hot(heir));
EventEmitter.prototype.emit = emit;
console.log(hot(emitter));

emitter.emit = () => false;
console.log(hot(emitter), Object.keys(emitter).includes("emit"));
delete (emitter as Partial<EventEmitter>).emit;
console.log(hot(emitter));

const listenerCount = EventEmitter.prototype.listenerCount;
Object.defineProperty(EventEmitter.prototype, "listenerCount", { get: () => () => "from a getter", configurable: true });
console.log(hot(emitter));
Object.defineProperty(EventEmitter.prototype, "listenerCount", { value: listenerCount, writable: true, configurable: true, enumerable: true });
console.log(hot(emitter));

Object.setPrototypeOf(emitter, { emit: () => true, listenerCount: () => -1 });
console.log(hot(emitter), emitter instanceof EventEmitter);

console.log(Object.keys(EventEmitter.prototype).join());
console.log(Object.getPrototypeOf(EventEmitter.prototype) === Object.prototype, EventEmitter.prototype.constructor === EventEmitter);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(EventEmitter.prototype, "constructor"), (key, value) => (typeof value === "function" ? value.name : value)));
