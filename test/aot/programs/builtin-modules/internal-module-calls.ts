// The runtime's own modules take functions and classes out of each other: `const { validateFunction } = require("internal/validators")`. Under --aot such a read is known to yield the function, and the call is a direct call. What a program sees of it stays the same: the same answers, and the same errors with the same codes and messages where what it hands in is turned away.
import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";

function attempt(what: string, run: () => unknown): void {
  try {
    const result = run();
    console.log(what, "->", typeof result);
  } catch (error: any) {
    console.log(what, "->", error.name, error.code, error.message);
  }
}

const emitter = new EventEmitter();
for (const wrong of [5, "text", null, undefined, {}, [], true, Symbol.iterator] as any[]) {
  attempt("on", () => emitter.on("event", wrong));
  attempt("once", () => emitter.once("event", wrong));
  attempt("prependListener", () => emitter.prependListener("event", wrong));
  attempt("prependOnceListener", () => emitter.prependOnceListener("event", wrong));
  attempt("off", () => emitter.off("event", wrong));
}
for (const wrong of [-1, NaN, "3", null, {}] as any[]) attempt("setMaxListeners", () => emitter.setMaxListeners(wrong));
attempt("setMaxListeners", () => emitter.setMaxListeners(20));
console.log(emitter.getMaxListeners(), emitter.listenerCount("event"));

let sum = 0;
const add = (n: number) => { sum += n; };
emitter.on("tick", add);
emitter.once("tick", n => { sum += 1000 * n; });
emitter.prependListener("tick", n => { sum *= 2; });
for (let i = 1; i <= 100; i++) emitter.emit("tick", i);
emitter.off("tick", add);
emitter.emit("tick", 7);
console.log(sum, emitter.listenerCount("tick"), emitter.eventNames().map(String).join());

for (const wrong of [{ highWaterMark: -1 }, { highWaterMark: "many" }, { read: 5 }, { signal: 5 }] as any[]) attempt("new Readable", () => new Readable(wrong));
for (const wrong of [{ highWaterMark: NaN }, { write: "no" }, { defaultEncoding: "nothing of the kind" }] as any[]) attempt("new Writable", () => new Writable(wrong));

const through = new PassThrough();
const pieces: string[] = [];
through.on("data", piece => pieces.push(String(piece)));
through.on("end", () => console.log(pieces.join("|"), through instanceof Readable, through instanceof Writable, through instanceof EventEmitter));
attempt("write", () => through.write(5 as any));
attempt("write", () => through.write(null as any));
through.write("one");
through.write(Buffer.from("two"));
through.end("three");
