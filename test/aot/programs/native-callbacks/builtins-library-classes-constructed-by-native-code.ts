// Built-ins applied by native code: classes that the library implements are constructed through Reflect.construct, bind, a proxy and `extends`, with options of odd types and with another new.target.
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

class Mine extends EventEmitter {
  mark = 1;
}
function Old(this: any) {
  EventEmitter.call(this);
}
Object.setPrototypeOf(Old.prototype, EventEmitter.prototype);

const results = [
  attempt(() => Reflect.construct(EventEmitter, [{ captureRejections: true }]).listenerCount("x")),
  attempt(() => Reflect.construct(EventEmitter, [{ captureRejections: "yes" }])),
  attempt(() => Reflect.construct(EventEmitter, [], Mine) instanceof Mine),
  attempt(() => (Reflect.construct(EventEmitter, [], Mine) as Mine).mark),
  attempt(() => new (EventEmitter.bind(null, 5 as any))().getMaxListeners()),
  attempt(() => new (new Proxy(EventEmitter, {}))().eventNames().length),
  attempt(() => new (Old as any)().on("x", () => {}).listenerCount("x")),
  attempt(() => Reflect.construct(Readable, [{ highWaterMark: "big" }])),
  attempt(() => Reflect.construct(Readable, [{ objectMode: 1, read: 5 }]).readableObjectMode),
  attempt(() => Reflect.construct(Writable, ["text"]).writableHighWaterMark > 0),
  attempt(() => [{}, undefined].map(options => new Readable(options as any).readableFlowing)),
];
console.log(results.join(" "));
