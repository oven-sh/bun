const said: string[] = [];
function make(first?: string) {
  let text = first!;
  let at: number;
  let limit: number;
  let notes = 0;
  function note() { notes++; }
  function unitAt(i: number) { return text.charCodeAt(i); }
  function isBlank(unit: number) { return unit === 32; }
  function step() { while (at < limit && unitAt(at) === 32) at++; return at; }
  function set(a: any, b: any, c: any) { text = a; at = b; limit = c; }
  return { step, set, poke(to: any) { at = to; }, swap(to: any) { text = to; }, cut(to: any) { limit = to; }, notes: () => notes };
}
const { step, set, poke, swap, cut } = make();
(globalThis as any).made = make;
function show(value: unknown) { return typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value); }
function go() { try { said.push(show(step())); } catch (error) { said.push("thrown " + (error as Error).constructor.name); } }
for (let round = 0; round < 30; round++) { set("     x".slice(round % 3), 0, 6 - round % 3); step(); }
set("   x", 0, 4); go();
set("  \u3000 x", 0, 5); go(); go();
set("  x", 0, 3); go();
console.log(said.join(" | "));
