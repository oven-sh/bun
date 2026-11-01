// JSON.stringify of lists of numbers, in every storage and at every place a list can stand.
const write = (value: unknown): string | undefined => JSON.stringify(value);
const writeNumbers = (list: number[]): string => JSON.stringify(list);
const writeHolder = (holder: { id: number; list: number[]; tail: string }): string => JSON.stringify(holder);
const writeLists = (lists: number[][]): string => JSON.stringify(lists);
let sum = 0;
const mix = (text: string | undefined) => {
  if (text === undefined) { sum = (sum + 7) | 0; return; }
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
};
const say = (name: string, run: () => unknown) => {
  try { console.log(name, String(run())); } catch (error) { console.log(name, "throws", (error as Error).name); }
};
const special = [0, -0, 1, -1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 99999999, 100000000, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 2 ** 53, -(2 ** 53), 1e21, -1e21, 1e-7, 0.1, -0.5, 1.5, 123456.789, 5e-324, 1.7976931348623157e308, NaN, Infinity, -Infinity];
say("integers", () => writeNumbers(special.filter(n => Number.isInteger(n) && Math.abs(n) < 2 ** 31 && !Object.is(n, -0))));
say("all", () => writeNumbers(special));
say("one each", () => special.map(n => writeNumbers([n])).join(" "));
say("empty", () => writeNumbers([]));
say("holder", () => writeHolder({ id: 1, list: [1, 2.5, 3], tail: "t" }));
say("holder of integers", () => writeHolder({ id: 1, list: [1, 2, 3], tail: "t" }));
say("holder of nothing", () => writeHolder({ id: 1, list: [], tail: "t" }));
say("lists", () => writeLists([[1], [], [2.5, 3], [4, 5, 6]]));
say("holes in integers", () => { const list = [1, 2, 3, 4]; delete list[1]; return writeNumbers(list); });
say("holes in fractions", () => { const list = [1.5, 2.5, 3.5]; delete list[2]; return writeNumbers(list); });
say("only holes", () => writeNumbers(new Array(3)));
say("longer by length", () => { const list = [1, 2]; list.length = 4; return writeNumbers(list); });
say("shorter by length", () => { const list = [1, 2, 3]; list.length = 1; return writeNumbers(list); });
say("a string among them", () => { const list: number[] = [1, 2]; (list as unknown[]).push("x"); return writeNumbers(list); });
say("frozen", () => writeNumbers(Object.freeze([1, 2.5]) as number[]));
say("own toJSON", () => { const list = [1, 2]; (list as any).toJSON = () => "own"; return writeNumbers(list); });
say("own name", () => { const list = [1, 2]; (list as any).extra = 1; return writeNumbers(list); });
say("a getter at an index", () => { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get: () => 9, enumerable: true }); return writeNumbers(list); });
say("another prototype", () => { const list = [1, , 3] as number[]; Object.setPrototypeOf(list, { 1: 7, __proto__: Array.prototype }); return writeNumbers(list); });
class Below extends Array<number> {}
say("a class below Array", () => writeNumbers(Below.from([1, 2.5])));
say("unknown", () => [write([1, 2]), write([1.5]), write([]), write([[1], [2.5]]), write({ a: [1, 2] })].join(" "));
for (const length of [1, 2, 3, 31, 32, 33, 127, 128, 1023, 1024, 1025, 2048, 5000, 70000]) {
  const integers = Array.from({ length }, (_, k) => (k * 7919) % 100003 - 50000);
  const fractions = Array.from({ length }, (_, k) => k / 8 - 3);
  const long = Array.from({ length }, (_, k) => -1.7976931348623157e308 / (k + 1));
  for (const list of [integers, fractions, long]) {
    const text = writeNumbers(list);
    mix(text);
    if (text !== "[" + list.map(n => String(n)).join(",") + "]") console.log("another text at", length);
    mix(writeHolder({ id: length, list, tail: "t" }));
  }
}
console.log(sum);
