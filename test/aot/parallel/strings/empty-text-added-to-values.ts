// "" + x, x + "" and the empty text among other parts, for every kind of primitive, where the compiler knows the type and where it does not; objects and symbols, whose conversion can be seen, keep their order and their errors.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail as T;
function say(label: string, ...values: unknown[]) { lines.push(label + ": " + values.map(v => typeof v === "string" ? JSON.stringify(v) : String(v)).join(" ")); }

const numbers: number[] = hide([0, -0, 1, -1, 7, 42, 255, 256, 1023, 65536, 2147483647, -2147483648, 2147483648, 4294967296, 0.5, -1.25, 1e21, 1e-7, NaN, Infinity, -Infinity]);
for (const n of numbers) say("number", "" + n, n + "", "" + n + "", "" + n + n, n + "" + n, `${n}` + "", "" + (n + n), "a" + "" + n, "" + "" + n);
const integers: number[] = hide([0, 1, 9, 10, 99, 100, 12345, -12345]);
for (let i = 0; i < integers.length; i++) { const n = integers[i]! | 0; say("integer", "" + n, n + "", "" + n + n, "" + (n + 1), ("" + n).length); }
const texts: string[] = hide(["", "a", "text", "ünï", "日本"]);
for (const t of texts) say("string", "" + t, t + "", "" + t + "", "" + t + t, ("" + t) === t, "" + "" === t);
for (const b of hide([true, false])) say("boolean", "" + b, b + "", "" + b + b);
for (const z of hide([undefined, null] as (undefined | null)[])) say("nothing", "" + z, z + "", "" + z + z);
for (const g of hide([0n, -5n, 123456789012345678901234567890n])) say("bigint", "" + g, g + "", "" + g + g);
const unknowns: unknown[] = hide<unknown[]>([1, "s", true, null, undefined, 2n, [1, 2], { toString() { return "object"; } }, { valueOf() { return 3; } }, { [Symbol.toPrimitive](hint: string) { return hint; } }]);
for (const u of unknowns) say("unknown", "" + (u as any), (u as any) + "", "" + (u as any) + (u as any));

const order: string[] = [];
const first = { toString() { order.push("first"); return "1"; } }, second = { valueOf() { order.push("second"); return 2; } };
say("order", "" + first + second, first + "" + second, (first as any) + (second as any) + "", order.join());
for (const make of [() => "" + (Symbol("s") as any), () => (Symbol("s") as any) + "", () => "" + (hide(Symbol.iterator) as any) + 1, () => `${hide(Symbol("t")) as any}`]) {
  try { say("symbol", make()); } catch (error) { say("symbol", (error as Error).constructor.name, (error as Error).message); }
}
let total = 0;
const rounds = Number(process.argv[2] ?? 2000);
for (let i = 0; i < rounds; i++) total += ("" + numbers[i % 12]!).length + (integers[i & 7]! + "").length + ("" + i + "").length;
say("total", total);
console.log(lines.join("\n"));
