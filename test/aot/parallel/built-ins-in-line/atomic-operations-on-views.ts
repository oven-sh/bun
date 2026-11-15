function all(view: Int32Array | Uint8Array | Int16Array | Uint32Array, at: number, value: number) {
  const seen: (number | string)[] = [];
  seen.push(Atomics.store(view, at, value), Atomics.load(view, at));
  seen.push(Atomics.add(view, at, 3), Atomics.load(view, at));
  seen.push(Atomics.sub(view, at, 5), Atomics.load(view, at));
  seen.push(Atomics.and(view, at, 0xf0f), Atomics.load(view, at));
  seen.push(Atomics.or(view, at, 0x30), Atomics.load(view, at));
  seen.push(Atomics.xor(view, at, 0xff), Atomics.load(view, at));
  seen.push(Atomics.exchange(view, at, 77), Atomics.load(view, at));
  seen.push(Atomics.compareExchange(view, at, 77, 78), Atomics.load(view, at));
  seen.push(Atomics.compareExchange(view, at, 77, 79), Atomics.load(view, at));
  return seen.join(" ");
}
for (const value of [0, 1, -1, 255, 256, 65535, 65536, 2147483647, -2147483648, 4294967295, 1.9, NaN]) {
  console.log(value, "|", all(new Int32Array(4), 1, value));
  console.log(value, "|", all(new Uint8Array(4), 3, value));
  console.log(value, "|", all(new Int16Array(4), 0, value));
  console.log(value, "|", all(new Uint32Array(new SharedArrayBuffer(16)), 2, value));
}
function wide(view: BigInt64Array) {
  return [Atomics.store(view, 0, 5n), Atomics.add(view, 0, 9223372036854775807n), Atomics.load(view, 0), Atomics.compareExchange(view, 0, -9223372036854775804n, 1n), Atomics.load(view, 0)].join(" ");
}
console.log(wide(new BigInt64Array(1)));
for (const at of [4, -1, 1.5]) {
  try {
    console.log(Atomics.load(new Int32Array(4), at));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
try {
  Atomics.add(new Float64Array(1) as never, 0, 1);
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(Atomics.isLockFree(1), Atomics.isLockFree(2), Atomics.isLockFree(4), Atomics.isLockFree(3));
