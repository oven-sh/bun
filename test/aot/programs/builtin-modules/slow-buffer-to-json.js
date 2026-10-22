// SlowBuffer of node:buffer makes a Buffer, and Buffer.prototype.toJSON is written in JavaScript. Nothing else in this program uses Buffer.
// What a SlowBuffer holds at birth is what the memory held before, so of its data only the length is printed.
import { SlowBuffer } from "node:buffer";
const json = SlowBuffer(2).toJSON();
console.log(json.type, json.data.length, SlowBuffer.prototype.toJSON.call(new Uint8Array(1)));
