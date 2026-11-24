// Built-in functions as callbacks over lists of every kind of element.
const show = (value: any): string => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).join() + "}" : String(value));
const whole: number[] = []; for (let k = 0; k < 20; k++) whole.push(k * 37 % 101 - 30);
const halves: number[] = []; for (let k = 0; k < 20; k++) halves.push(k * 0.5 - 3);
const bounds: number[] = [2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 32, 2 ** 53, -(2 ** 53), 0, -0, 1];
const unusual: number[] = [NaN, Infinity, -Infinity, -0, 0, 5e-324, 1.7976931348623157e308, -0.5, 0.5, 1.5, 2.5, -1.5];
const digits = "12 7 345 0 -99 1e3 0x10 5.75 abc  64".split(" ");
const words: string[] = []; for (let k = 0; k < 12; k++) words.push("w" + k);
const flags: boolean[] = []; for (let k = 0; k < 9; k++) flags.push(k % 2 === 0);
const missing: (string | undefined | null)[] = []; for (let k = 0; k < 9; k++) missing.push(k % 3 === 0 ? undefined : k % 3 === 1 ? null : "m" + k);
const mixed: any[] = []; for (let k = 0; k < 12; k++) mixed.push(k % 4 === 0 ? k : k % 4 === 1 ? "s" + k : k % 4 === 2 ? k + 0.25 : { k });
const big: bigint[] = [1n, 2n ** 64n, -5n, 0n];
const holes: any[] = [1, , 2.5, , "x"];
const rows: number[][] = []; for (let k = 0; k < 6; k++) rows.push([k, k * k]);
let turns = 0;
function numbersOf(list: number[]) {
  const out: any[] = [];
  out.push(list.map(Math.floor), list.map(Math.ceil), list.map(Math.round), list.map(Math.abs), list.map(Math.trunc), list.map(Math.sign), list.map(Math.sqrt), list.map(Math.fround), list.map(Math.max as any), list.map(Math.min as any), list.map(Math.pow as any), list.map(Math.clz32));
  out.push(list.map(String), list.map(Number), list.map(Boolean), list.map(parseInt as any), list.map(parseFloat as any), list.map(isNaN), list.map(Number.isInteger), list.map(Object.is as any), list.map(encodeURIComponent as any));
  out.push(list.filter(Boolean), list.filter(isNaN), list.filter(isFinite), list.filter(Number.isSafeInteger), list.filter(Math.floor as any), list.filter(Math.sign));
  out.push(list.some(isNaN), list.every(Number.isInteger), list.find(Boolean), list.findIndex(isNaN), list.findLast(Boolean), list.findLastIndex(Number.isInteger), list.reduce(Math.max as any), list.reduceRight(Math.min as any), list.flatMap(Array.of as any).length, list.flatMap(Math.floor));
  return out;
}
for (let round = 0; round < 40; round++) {
  const answers = [whole, halves, bounds, unusual].map(numbersOf);
  const texts = [digits.map(Number), digits.map(parseInt as any), digits.map(parseFloat), digits.map(String), digits.filter(Boolean), digits.map(Boolean), digits.filter(isNaN as any), words.map(encodeURIComponent as any), words.map(String), words.map(Number), words.filter(Boolean).length, words.map(Object as any).length, words.flatMap(Array.of as any).length, words.map(Array.isArray)];
  const others = [flags.map(Number), flags.map(String), flags.filter(Boolean).length, missing.map(String), missing.map(Number as any), missing.filter(Boolean), missing.map(Boolean), mixed.map(String), mixed.map(Number), mixed.filter(Boolean).length, mixed.map(Math.floor), big.map(String), big.map(Number), big.map(Boolean), big.filter(Boolean), holes.map(String), holes.map(Math.floor), holes.filter(Boolean), rows.map(String), rows.map(Array.isArray), rows.flatMap(Array.of as any).length, rows.map(Math.max as any), rows.map(Object.keys as any)];
  if (round === 0 || round === 39) { for (const answer of answers) console.log(answer.map(show).join(" ")); console.log(texts.map(show).join(" ")); console.log(others.map(show).join(" ")); }
  turns += answers.length + texts.length;
}
// Elements whose conversion runs code of the program.
const seen: string[] = [];
const list: any[] = [1.5, { valueOf() { seen.push("first"); list.length = 4; return 2.5; } }, { valueOf() { seen.push("second"); list[3] = "9.5"; return 3.5; } }, 4.5, 5.5, 6.5];
console.log(show(list.map(Math.floor)), seen.join());
const thrown: any[] = [1, { valueOf() { throw new RangeError("no number"); } }, 3];
for (let k = 0; k < 3; k++) { try { thrown.map(Math.floor as any); } catch (error: any) { console.log(error.name, error.message); } try { thrown.map(Symbol.prototype.toString.call as any); } catch (error: any) { console.log(error.name); } try { [1n, 2].map(Math.floor as any); } catch (error: any) { console.log(error.name); } try { [Symbol()].map(String).forEach(text => console.log(text)); [Symbol()].map(Number as any); } catch (error: any) { console.log(error.name); } }
// A list that holds numbers, until it holds something else.
const later: any[] = []; for (let k = 0; k < 10; k++) later.push(k + 0.5);
function floors(values: any[]) { let sum = 0; for (let k = 0; k < 30; k++) { const made = values.map(Math.floor); for (const one of made) sum += one; } return sum; }
console.log(floors(later)); later.push("7.75"); console.log(floors(later)); later.push({ valueOf: () => 3.25 }); console.log(floors(later)); later[2] = undefined; console.log(floors(later));
const frozen = Object.freeze([1.5, 2.5, -0.5]), proxied = new Proxy([1.5, 2.5], {}); class Sub extends Array<number> { } const sub = Sub.from([1.25, 2.75]);
console.log(show(frozen.map(Math.floor)), show(proxied.map(Math.floor)), sub.map(Math.floor) instanceof Sub, show([...sub.map(Math.ceil)]), show(Array.prototype.map.call("123", Number)), show(Array.prototype.map.call({ length: 2, 0: 1.5, 1: "2.5" }, Math.floor)));
const views = [new Float64Array([1.5, -0.5, NaN]), new Int32Array([1, 2])]; for (const view of views) console.log(show([...view.map(Math.floor)]), show([...view.filter(Boolean as any)]));
console.log(turns);
