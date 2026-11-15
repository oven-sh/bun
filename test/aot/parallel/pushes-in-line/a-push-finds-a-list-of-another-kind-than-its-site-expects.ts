const data: any[] = JSON.parse('[1, 2.5, "text", null, {"a": 1}, -0, 4294967296, true]');
function pushAnything(list: unknown[], value: unknown): number { return list.push(value); }
function pushNumber(list: number[], value: number): number { return list.push(value); }
function pushText(list: string[], value: string): number { return list.push(value); }
function show(list: unknown[]): string { return list.length + ":" + list.map(x => (Object.is(x, -0) ? "-0" : typeof x === "object" ? JSON.stringify(x) : String(x))).join(","); }
function births(): unknown[][] { return [[], [1, 2], [1.5, 2.5], ["a"], [1, "a"], new Array(3), new Array(0), Array.from({ length: 2 }, (_, i) => i), [, 1], JSON.parse("[7,8]")]; }
for (const value of data) {
  let said = "";
  for (const list of births()) { const told = pushAnything(list, value); said += told + "=" + show(list) + " "; }
  console.log(said);
}
for (const list of births()) {
  for (let i = 0; i < 40; i++) pushAnything(list, data[i & 7]);
  console.log(show(list));
}
const whole: number[] = [], fractions: number[] = [0.5], texts: string[] = [];
for (let i = 0; i < 70; i++) { pushNumber(whole, i); pushNumber(fractions, i); pushText(texts, "t" + i); }
pushNumber(whole, 0.25); pushNumber(whole, NaN); pushNumber(fractions, NaN); pushNumber(whole, -0);
console.log(show(whole), show(fractions), show(texts));
for (const make of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const list: unknown[] = make([1, 2, 3]) as unknown[];
  try { console.log("told", pushAnything(list, 4)); } catch (error) { console.log((error as Error).constructor.name); }
  console.log(show(list));
}
class Heir extends Array<unknown> {}
const heir = new Heir(); console.log(pushAnything(heir, 1), pushAnything(heir, "x"), heir.length, heir instanceof Heir);
const fixed: unknown[] = [1]; Object.defineProperty(fixed, "length", { writable: false });
try { pushAnything(fixed, 2); console.log("stored"); } catch (error) { console.log((error as Error).constructor.name); }
console.log(show(fixed));
