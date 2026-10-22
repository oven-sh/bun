// A number field that looks like int32 gets a string, null, undefined, a boolean, a bigint, a symbol, an object, an array and a function: through a hidden caller of the typed function that stores it,
// through a generic helper, through a closure, and by stores that the build cannot attribute. Plain JavaScript keeps whatever was stored, and so must the compiled program, in the same place among the keys.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Slot { before = 1; n = 0; after = 2; }
function id<T>(x: T): T {
  return x;
}
function direct(slot: Slot, n: number) { slot.n = n; }
function helped(slot: Slot, n: number) { slot.n = id(n); }
function captured(slot: Slot, n: number) { return () => { slot.n = n; }; }
function fresh() {
  const slot = new Slot();
  handOver(slot);
  return slot;
}
function describe(slot: Slot) {
  const held: unknown = (slot as any).n;
  const shown = typeof held === "symbol" ? held.toString() : typeof held === "bigint" ? held + "n" : typeof held === "function" ? "function" : typeof held === "object" ? JSON.stringify(held) : exact(held);
  let json: string;
  try {
    json = JSON.stringify(slot);
  } catch (error) {
    json = (error as Error).constructor.name;
  }
  return `${shown} [${Object.keys(slot)}] ${json} ${"n" in slot} ${slot.before + slot.after}`;
}
const strangers: unknown[] = ["text", "", "12", null, undefined, true, false, 10n, Symbol.for("s"), { k: 1 }, [3], () => 1, new Number(5), new Date(0)];
const key: string = JSON.parse('"n"');
const routes: [string, (slot: Slot, value: any) => void][] = [
  ["a hidden caller", (slot, value) => direct.call(undefined, slot, value)],
  ["a helper", (slot, value) => helped.apply(undefined, [slot, value])],
  ["a closure", (slot, value) => Reflect.apply(captured, undefined, [slot, value])()],
  ["a computed key", (slot, value) => { (slot as any)[key] = value; }],
  ["Object.assign", (slot, value) => { Object.assign(slot, { [key]: value }); }],
  ["Object.defineProperty", (slot, value) => { Object.defineProperty(slot, key, { value }); }],
];
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const slot = fresh();
  direct(slot, i & 7);
  helped(slot, slot.n + 1);
  captured(slot, slot.n + 1)();
  sum += slot.n + id("s").length + id({ k: 2 }).k;
}
console.log("warm", sum);
for (const [label, put] of routes) {
  console.log(label + ":");
  for (const value of strangers) {
    const slot = fresh();
    put(slot, value);
    const same = Object.is((slot as any).n, value);
    const first = describe(slot);
    direct(slot, 9);
    console.log(`  ${same} ${first} | then 9: ${describe(slot)}`);
  }
}
