// Held from creation: slice, map and filter construct a typed array subclass with a length, subarray with (buffer, offset, length); every `new` in the program passes an array of numbers.
let total = 0;

class Bytes extends Uint8Array {
  constructor(source: number[], offset?: number, length?: number) {
    super(source as any, offset, length);
    total += Array.isArray(source) ? 1 : typeof source === "number" ? 100 : (source as any) instanceof ArrayBuffer ? 10000 : 1000000;
    total += typeof offset === "number" ? 100000000 : 0;
  }
}

const bytes = new Bytes([1, 2, 3, 4]);
const made = [bytes.slice(1), bytes.map(x => x * 2), bytes.filter(x => x > 2), bytes.subarray(1, 3), Bytes.from([5, 6]), Bytes.of(7)];
console.log(total, made.map(one => one.length + ":" + (one instanceof Bytes) + ":" + one.join("")).join(" "));
