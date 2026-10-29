// keys(), values(), entries() and [Symbol.iterator]() of a typed array return an iterator over it: in for..of, stepped by hand, spread, destructured, half used, passed on, over a view that changes meanwhile, and with the view read and written afterwards.
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
    said = error instanceof TypeError ? "TypeError" : "another error";
  }
  lines.push(name + ": " + said);
}

function counting(length: number): Uint8Array {
  const view = new Uint8Array(length);
  for (let i = 0; i < length; i++) view[i] = i * 3 + 1;
  return view;
}
function sumValues(view: Uint8Array): number {
  let sum = 0;
  for (const value of view.values()) sum += value;
  return sum;
}
function sumKeys(view: Uint8Array): number {
  let sum = 0;
  for (const key of view.keys()) sum += key;
  return sum;
}
function sumEntries(view: Float64Array): number {
  let sum = 0;
  for (const [key, value] of view.entries()) sum += key * value;
  return sum;
}
function sumDefault(view: Int32Array): number {
  let sum = 0;
  for (const value of view[Symbol.iterator]()) sum += value;
  return sum;
}
function step(iterator: Iterator<unknown>, times: number): unknown[] {
  const seen: unknown[] = [];
  for (let i = 0; i < times; i++) {
    const result = iterator.next();
    seen.push(result.done, result.value);
  }
  return seen;
}
function walk(collection: any): string {
  let said = "";
  for (const [key, value] of collection.entries()) said += show(key) + "=" + show(value) + " ";
  return said;
}
function resizable(): [ArrayBuffer, Uint8Array] {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer);
  view.set([1, 2, 3, 4]);
  return [buffer, view];
}

attempt("values", () => [sumValues(counting(0)), sumValues(counting(1)), sumValues(counting(40))]);
attempt("keys", () => [sumKeys(counting(0)), sumKeys(counting(1)), sumKeys(counting(40))]);
attempt("entries", () => [sumEntries(new Float64Array(0)), sumEntries(new Float64Array([0.5, 1.5, -2.25, 1e3]))]);
attempt("the default iterator", () => [sumDefault(new Int32Array(0)), sumDefault(new Int32Array([2147483647, -2147483648, 5]))]);

attempt("values, stepped past the end", () => step(new Int16Array([-1, 2]).values(), 4));
attempt("keys, stepped past the end", () => step(new Int16Array(2).keys(), 4));
attempt("entries, stepped past the end", () => step(new Uint32Array([7, 4294967295]).entries(), 4));
attempt("the default iterator, stepped", () => step(new Float32Array([1.5, -0, NaN])[Symbol.iterator](), 4));
attempt("big integers", () => [[...new BigInt64Array([1n, -2n]).values()], [...new BigUint64Array([3n]).entries()], [...new BigInt64Array(2).keys()]]);

attempt("spread", () => {
  const view = counting(3);
  return [[...view.keys()], [...view.values()], [...view.entries()], [...view[Symbol.iterator]()]];
});
attempt("destructured", () => {
  const [first, second = -1, ...rest] = counting(4).values();
  const [only, missing = -1] = counting(1).values();
  const [[key, value]] = counting(2).entries();
  return [first, second, rest, only, missing, key, value];
});
attempt("half used", () => {
  const iterator = counting(5).values();
  iterator.next();
  iterator.next();
  return [[...iterator], [...iterator]];
});
attempt("left early", () => {
  const iterator = counting(5).keys();
  for (const key of iterator) if (key === 1) break;
  return [...iterator];
});
attempt("an iterator is its own iterable", () => {
  const iterator = counting(2).entries();
  return iterator[Symbol.iterator]() === iterator;
});
attempt("two iterators over one view", () => {
  const view = counting(3);
  const first = view.values();
  const second = view.values();
  return [first === second, first.next().value, first.next().value, second.next().value];
});
attempt("pairs are not shared", () => {
  const pairs = [...counting(2).entries()];
  pairs[0][1] = 99;
  return [pairs, pairs[0] === pairs[1]];
});
attempt("passed on", () => [Array.from(counting(3).keys()), new Set(counting(3).values()).size, new Map(counting(2).entries()).get(1), Math.max(...counting(3).values())]);

attempt("written meanwhile", () => {
  const view = counting(4);
  const seen: number[] = [];
  for (const [key, value] of view.entries()) {
    seen.push(value);
    if (key + 1 < view.length) view[key + 1] = 200 + key;
  }
  return [seen, Array.from(view)];
});
attempt("the view afterwards", () => {
  const view = counting(3);
  const iterator = view.values();
  view[0] = 50;
  const first = iterator.next().value;
  view.fill(9);
  return [first, [...iterator], view.length, view[2], sumValues(view)];
});
attempt("shrunk meanwhile", () => {
  const [buffer, view] = resizable();
  const seen: number[] = [];
  for (const value of view.values()) {
    seen.push(value);
    if (seen.length === 2) buffer.resize(3);
  }
  return seen;
});
attempt("grown meanwhile", () => {
  const [buffer, view] = resizable();
  const seen: number[] = [];
  for (const key of view.keys()) {
    seen.push(key);
    if (seen.length === 2) buffer.resize(6);
  }
  return seen;
});
attempt("grown after the end", () => {
  const [buffer, view] = resizable();
  const iterator = view.values();
  const seen = [...iterator];
  buffer.resize(6);
  return [seen, step(iterator, 1)];
});
attempt("detached before a step", () => {
  const buffer = new ArrayBuffer(2);
  const iterator = new Uint8Array(buffer).values();
  const first = iterator.next().value;
  buffer.transfer();
  return [first, iterator.next().value];
});
attempt("detached before the call", () => {
  const buffer = new ArrayBuffer(2);
  const view = new Uint8Array(buffer);
  buffer.transfer();
  return typeof view.entries();
});

class Samples extends Float32Array {
  total(): number {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}
attempt("a subclass", () => [new Samples([0.5, 0.25]).total(), [...new Samples(2).keys()]]);
attempt("a Buffer", () => [[...Buffer.from([6, 7]).entries()], [...Buffer.from("ab").values()]]);
attempt("borrowed by an array", () => typeof Uint8Array.prototype.values.call([1, 2] as any));
attempt("borrowed by another typed array", () => [...Uint8Array.prototype.entries.call(new Float64Array([0.5]) as any)]);
attempt("the kind of object", () => {
  const iterator = counting(1).values();
  const arrayIterator = [0].values();
  return [typeof iterator.next, Object.prototype.toString.call(iterator), Object.getPrototypeOf(iterator) === Object.getPrototypeOf(arrayIterator), Object.keys(iterator).length];
});
attempt("through any", () => [walk(counting(2)), walk(new BigInt64Array([5n])), walk([1, , 3]), walk(new Map([["a", 1]]))]);

console.log(lines.join("\n"));
