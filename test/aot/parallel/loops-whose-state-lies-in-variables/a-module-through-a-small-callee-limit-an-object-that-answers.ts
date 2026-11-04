const said: string[] = [];
let text: string;
let at: number;
let limit: number;
let notes = 0;
function note() { notes++; }
function unitAt(i: number) { return text.charCodeAt(i); }
function isBlank(unit: number) { return unit === 32; }
function step() { while (at < limit && unitAt(at) === 32) at++; return at; }
function set(a: any, b: any, c: any) { text = a; at = b; limit = c; }
function poke(to: any) { at = to; }
function swap(to: any) { text = to; }
function cut(to: any) { limit = to; }
(globalThis as any).made = [step, set, poke, swap, cut];
function show(value: unknown) { return typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value); }
function go() { try { said.push(show(step())); } catch (error) { said.push("thrown " + (error as Error).constructor.name); } }
for (let round = 0; round < 30; round++) { set("     x".slice(round % 3), 0, 6 - round % 3); step(); }
set("   x", 0, 4); go();
set("   x", 0, { valueOf() { said.push("asked"); return 2; } }); go(); go();
set("  x", 0, 3); go();
console.log(said.join(" | "));
