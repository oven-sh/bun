// util.inspect() of a typed array whose prototype was taken away makes a copy with the constructor of the array's own type.
import { inspect } from "node:util";

const types = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array] as const;
for (const type of types) {
  const bare = Object.setPrototypeOf(new type([1, 2, 3]), null);
  console.log(inspect(bare), "|", inspect(bare, { showHidden: true }).replaceAll("\n", " "));
}
for (const type of [BigInt64Array, BigUint64Array]) console.log(inspect(Object.setPrototypeOf(new type([1n, 2n]), null)));
console.log(inspect(Object.setPrototypeOf(Buffer.from("abc"), null)));
console.log(inspect(Object.setPrototypeOf(new Uint8Array(0), null)), inspect({ nested: Object.setPrototypeOf(new Int16Array(200), null) }).length);
class Mine extends Uint16Array {}
console.log(inspect(Object.setPrototypeOf(new Mine(2), null)), inspect(new Mine(2)));
