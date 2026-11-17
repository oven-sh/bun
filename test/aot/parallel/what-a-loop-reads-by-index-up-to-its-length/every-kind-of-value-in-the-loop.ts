const said: string[] = []; function report(value: unknown) { said.push(String(value)); }
const table: any = {};
function lay(name: string, what: unknown) { table[name] = what; }
function sum(name: string) { const x = table[name]; let s: any = 0; for (let i = 0; i < x.length; i++) s += x[i].v; return s; }
function count(name: string) { const x = table[name]; let n = 0; for (let i = 0; i < x.length; i++) if (x[i] === "e") n++; return n; }
function bytes(name: string) { const x = table[name]; let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function shrink(name: string) { const x = table[name]; let s = 0; for (let i = 0; i < x.length; i++) { s += x[i].v; if (i === 1) x.length = 3; } return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name + ": " + (e as Error).message); } }
const names = ["records", "fractions", "texts", "holes", "text", "empty", "alike", "bytes", "getter", "nothing", "number", "frozen", "mixed", "accessor", "below"];
class Item { constructor(public v: unknown) { } }
class Below extends Array<Item> { }
const accessor = [new Item(1), new Item(2), new Item(3)]; Object.defineProperty(accessor, 1, { get() { return new Item(40); } });
const below = new Below(); below.push(new Item(5), new Item(6), new Item(7));
const values: unknown[] = [[new Item(1), new Item(2), new Item(3)], [new Item(0.5), new Item(1.5)], ["e", "f", "e"], [new Item(1), , new Item(3)], "eel", [], { length: 2, 0: new Item("e"), 1: new Item(7) }, new Uint8Array([1, 2, 3]), { get length() { return 1; }, 0: "e" }, undefined, 7, Object.freeze([new Item(1), new Item(2)]), [new Item(1), "e", { }, new Item("x")], accessor, below];
for (let i = 0; i < names.length; i++) lay(names[i]!, values[i]);
for (let turn = 0; turn < 2; turn++) for (let i = 0; i < names.length; i++) { tell(() => String(sum(names[i]!))); tell(() => count(names[i]!)); tell(() => String(bytes(names[i]!))); }
lay("long", [new Item(1), new Item(2), new Item(3), new Item(4), new Item(5), new Item(6)]);
tell(() => shrink("long"));
report("end");
console.log(said.join("\n"));
