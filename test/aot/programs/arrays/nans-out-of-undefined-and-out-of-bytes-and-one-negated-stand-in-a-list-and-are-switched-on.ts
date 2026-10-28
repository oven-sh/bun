// A list holds a NaN out of arithmetic on undefined, one out of bytes, a sum with that one and the first one negated. Each is switched on, tested for its type and written into bytes.
const hex = (value: number) =>
  Array.from(new Uint8Array(new Float64Array([value]).buffer), byte => byte.toString(16).padStart(2, "0")).join("");

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 0xf8, 0xff, 7, 0, 0, 0, 0, 0, 0xf0, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0x40]);
const view = new Float64Array(bytes.buffer);
const sparse: (number | undefined)[] = [1.5, undefined, 2.5];

function describe(value: unknown) {
  switch (value) {
    case 0:
      return "zero";
    case 1:
      return "one";
    case 2:
      return "two";
  }
  return typeof value === "number" ? (value !== value ? "not a number" : "number " + value) : typeof value;
}

for (let round = 0; round < 3; round++) {
  const outOfUndefined = sparse[round]! * 2,
    outOfBytes = view[round]!,
    computedFromBytes = view[round]! + 1;
  for (const value of [outOfUndefined, outOfBytes, computedFromBytes, -outOfUndefined]) {
    console.log(round, describe(value), describe(value - value), hex(value));
  }
}
