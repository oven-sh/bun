// node:worker_threads reaches Bun's stream code, which calls methods of Bun.ArrayBufferSink. The compiler takes those methods for constants and start-up fixes them.
// The constructor has no property "prototype", so start-up finds the prototype object through the class.
import { isMainThread } from "node:worker_threads";

console.log(isMainThread, Object.hasOwn(Bun.ArrayBufferSink, "prototype"));

const sink = new Bun.ArrayBufferSink();
sink.start({ asUint8Array: true });
sink.write("ab");
sink.write(new Uint8Array([99]));
console.log(Array.from(sink.end()).join(" "));

const prototype = Object.getPrototypeOf(sink);
console.log(typeof prototype.write, typeof prototype.end, prototype === Object.getPrototypeOf(new Bun.ArrayBufferSink()));
