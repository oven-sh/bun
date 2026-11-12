const out: string[] = [];
const name = (error: unknown) => error instanceof Error ? error.name + ": " + error.message : String(error);
async function mask(n: number): Promise<number> { return n & 1023; }
async function plus(n: number): Promise<number> { return +n + 1; }
async function less(n: number): Promise<boolean> { return n < 5; }
async function size(list: { length: number }): Promise<number> { return list.length | 0; }
async function text(n: unknown): Promise<string> { return `t${n}`; }
async function same(n: number): Promise<number> { return n | 0; }
const bad = [
  { valueOf() { throw new Error("value"); }, toString() { throw new Error("string"); } },
  Symbol("s"), 10n, null, undefined, { valueOf() { out.push("valueOf"); return 7; }, toString() { out.push("toString"); return "o"; } },
  { get length() { throw new RangeError("length"); } }, new Proxy({}, { get(_, key) { throw new TypeError("get " + String(key)); } }), "12", 5, 2.5, -1,
] as unknown as number[];
const micro = (text: string) => queueMicrotask(() => out.push("micro " + text));
async function one(n: number): Promise<string> {
  let sum = "";
  try { micro("a"); sum += await mask(n); } catch (error) { sum += name(error); }
  try { sum += " " + await plus(n); } catch (error) { sum += " " + name(error); micro("b"); }
  try { sum += " " + await less(n); } catch (error) { sum += " " + name(error); }
  try { sum += " " + await size(n as unknown as { length: number }); } catch (error) { sum += " " + name(error); }
  try { sum += " " + await text(n); } catch (error) { sum += " " + name(error); } finally { micro("c"); }
  return sum + " " + await same(3);
}
async function open(n: number): Promise<number> { return await mask(n) + await plus(n); }
async function loops(): Promise<string> { let sum = 0; for (const n of bad) { try { sum += await mask(n); } catch (error) { sum += 1000; } } return "loops " + sum; }
async function main() {
  for (let round = 0; round < 2; round++) {
    for (const n of bad) { out.push(await one(n)); try { out.push("open " + await open(n)); } catch (error) { out.push("open threw " + name(error)); } }
    out.push(await loops());
    await 0;
  }
}
await main();
for (const n of bad) { out.push(await one(n)); try { out.push("open " + await open(n)); } catch (error) { out.push("open threw " + name(error)); } }
console.log(out.join("\n"));
