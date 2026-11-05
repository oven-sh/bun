// A read past the end gives undefined, which the operators take for 0 and the sum for no number.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
function mix(sums: Int32Array, words: Int32Array, turns: number): string {
  let a = sums[0]!, b = sums[1]!, c = sums[2]!, d = sums[3]!, e = sums[4]!;
  for (let t = 0; t < turns; t++) {
    const next = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + e + words[t]!) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
  }
  return [a, b, c, d, e].map(show).join(" ");
}
for (const length of [5, 4, 1, 0]) for (const turns of [0, 1, 3, 6]) console.log(length, turns, mix(hidden(new Int32Array(length).fill(7)), hidden(new Int32Array([1, 2, 3, 4])), turns));
