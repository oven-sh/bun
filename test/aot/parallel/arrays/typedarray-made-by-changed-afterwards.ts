// What `from` and `of` make is a typed array like any other: it can get names of its own, another prototype, lose its buffer, or come from a class below or a constructor that is none.
function total(list: ArrayLike<number>): number {
  let sum = 0;
  for (let k = 0; k < list.length; k++) sum += list[k]!;
  return sum;
}

const plain = Float64Array.from({ length: 6 }, (_, k) => k / 2);
const listed = Float64Array.of(1, 2.5, 4);
console.log(total(plain), total(listed), plain.constructor.name, Object.prototype.toString.call(listed));

const named = Float64Array.of(1, 2, 3);
Object.defineProperty(named, "length", { value: 2 });
console.log(total(named), named.length, total(Float64Array.of(1, 2, 3)));

const below = Uint8Array.from([1, 2, 3]);
Object.setPrototypeOf(below, {
  get length() {
    return 1;
  },
});
console.log(total(below), below instanceof Uint8Array, total(Uint8Array.from([1, 2, 3])));

const gone = Int16Array.from([7, 8, 9]);
gone.buffer.transfer();
console.log(total(gone), gone.length, gone[0]);

class Samples extends Float32Array {
  get length(): number {
    return 2;
  }
}
const samples = Samples.from([1, 2, 3]);
console.log(total(samples), samples instanceof Samples, samples.constructor.name, total(Samples.of(4, 5, 6)));

for (const maker of [Array, Object, function () {}, () => {}, Map]) {
  try {
    console.log(Object.prototype.toString.call(Float64Array.from.call(maker, [1, 2])));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
  try {
    console.log(Object.prototype.toString.call(Float64Array.of.call(maker, 1, 2)));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}

const longer = function (this: unknown, length: number) {
  return new Uint16Array(length + 2);
} as unknown as Uint16ArrayConstructor;
console.log(Uint16Array.from.call(longer, [5, 6]).length, Uint16Array.of.call(longer, 5, 6, 7).length);

const rows = Array.from({ length: 3 }, (_, r) => Int32Array.from({ length: 4 }, (_, c) => r * 4 + c));
(rows[1] as unknown as { extra: number }).extra = 1;
rows[2] = Int32Array.of(100);
console.log(rows.map(total).join(), Object.keys(rows[1]!).join());

// What native code makes for other built-ins is asked for a length too, and is no list.
new Promise((resolve, reject) => console.log(typeof resolve, resolve.length, reject.length));
