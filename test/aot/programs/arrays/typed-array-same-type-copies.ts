// toReversed, toSorted and with allocate a typed array of the receiver's element type and ask no species, so a Buffer and a subclass give a plain Uint8Array. The copy is then used as what it is. buffer-copy-methods-class.js is the untyped counterpart.
export {};

const lines: string[] = [];
function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join(",") + "]";
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(name: string, run: () => unknown): void {
  let said: string;
  try {
    said = show(run());
  } catch (error) {
    said = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "another error";
  }
  lines.push(name + ": " + said);
}
function describe(copy: Uint8Array): unknown[] {
  const hasPlainPrototype = Object.getPrototypeOf(copy) === Uint8Array.prototype;
  return [copy instanceof Buffer, hasPlainPrototype, copy.constructor === Uint8Array, typeof (copy as any).readUInt8, copy.length, Array.from(copy)];
}

function reverse(source: Buffer): Uint8Array {
  return source.toReversed();
}
function sort(source: Buffer): Uint8Array {
  return source.toSorted();
}
function sortDescending(source: Buffer): Uint8Array {
  return source.toSorted((left, right) => right - left);
}
function replace(source: Buffer, index: number, value: number): Uint8Array {
  return source.with(index, value);
}
function useCopy(source: Buffer): unknown[] {
  const copy = source.toReversed();
  copy.set([7], 1);
  copy[0] += 1;
  let digits = 0;
  for (const byte of copy) digits = digits * 10 + byte;
  return [digits, copy.subarray(1).length, copy.byteLength, copy.indexOf(7), Array.from(source)];
}

attempt("Buffer, toReversed", () => describe(reverse(Buffer.from([3, 1, 2]))));
attempt("Buffer, toSorted", () => describe(sort(Buffer.from([3, 1, 2]))));
attempt("Buffer, toSorted with a comparator", () => describe(sortDescending(Buffer.from([3, 1, 2]))));
attempt("Buffer, with", () => describe(replace(Buffer.from([3, 1, 2]), 0, 9)));
attempt("Buffer, with a negative index", () => describe(replace(Buffer.from([3, 1, 2]), -1, 300)));
attempt("Buffer, with an index past the end", () => describe(replace(Buffer.from([3, 1, 2]), 3, 0)));
attempt("Buffer, no elements", () => [describe(reverse(Buffer.alloc(0))), describe(sort(Buffer.alloc(0)))]);
attempt("Buffer, part of a pool", () => describe(reverse(Buffer.from("abc"))));
attempt("the copy in use", () => useCopy(Buffer.from([3, 1, 2])));
attempt("every call allocates", () => {
  const source = Buffer.from([1, 2]);
  const first = reverse(source);
  const second = reverse(source);
  first[0] = 9;
  return [first === second, first.buffer === second.buffer, first.buffer === source.buffer, Array.from(second), Array.from(source)];
});

class Bytes extends Uint8Array {
  first(): number {
    return this[0];
  }
}
function copiesOf(source: Bytes): Uint8Array[] {
  return [source.toReversed(), source.toSorted(), source.toSorted((left, right) => right - left), source.with(1, 7)];
}
attempt("a subclass", () => copiesOf(new Bytes([5, 4, 6])).map(copy => [copy instanceof Bytes, copy.constructor === Uint8Array, typeof (copy as any).first, Array.from(copy)]));

class Watched extends Uint8Array {
  static get [Symbol.species](): Uint8ArrayConstructor {
    lines.push("the species was asked");
    return Uint8Array;
  }
}
attempt("a subclass with a species", () => {
  const source = new Watched([2, 1]);
  const copies = [source.toReversed(), source.toSorted(), source.with(0, 3)];
  lines.push("now slice");
  copies.push(source.slice());
  return copies.map(copy => [copy instanceof Watched, Array.from(copy)]);
});
attempt("an own constructor property", () => {
  const source = new Uint8Array([2, 1]);
  Object.defineProperty(source, "constructor", { get() { lines.push("constructor was read"); return undefined; } });
  return [Array.from(source.toReversed()), Array.from(source.toSorted()), Array.from(source.with(0, 3))];
});

attempt("doubles", () => {
  const source = new Float64Array([1.5, -0, NaN, 0, -Infinity]);
  const copies = [source.toReversed(), source.toSorted(), source.with(1, 0.25)];
  return copies.map(copy => [copy.constructor === Float64Array, Array.from(copy)]);
});
attempt("clamped bytes", () => {
  const copy = new Uint8ClampedArray([1, 2]).with(0, 300);
  return [copy.constructor === Uint8ClampedArray, Array.from(copy)];
});
attempt("big integers", () => {
  const source = new BigInt64Array([3n, -1n, 2n]);
  const copies = [source.toReversed(), source.toSorted(), source.with(0, 5n)];
  return copies.map(copy => [copy.constructor === BigInt64Array, Array.from(copy)]);
});
attempt("a number for a big integer", () => Array.from((new BigInt64Array(1) as any).with(0, 5)));
attempt("a length-tracking view", () => {
  const buffer = new ArrayBuffer(2, { maxByteLength: 4 });
  const source = new Uint8Array(buffer);
  source.set([1, 2]);
  const copy = source.toReversed();
  buffer.resize(4);
  return [source.length, copy.length, copy.buffer.resizable, Array.from(copy)];
});
attempt("a detached view", () => {
  const buffer = new ArrayBuffer(2);
  const source = new Uint8Array(buffer);
  buffer.transfer();
  return Array.from(source.toReversed());
});
attempt("a comparator that is no function", () => Array.from((new Uint8Array(2) as any).toSorted(5)));
attempt("a comparator that throws", () => Array.from(new Uint8Array([2, 1]).toSorted(() => { throw new RangeError("from the comparator"); })));

console.log(lines.join("\n"));
