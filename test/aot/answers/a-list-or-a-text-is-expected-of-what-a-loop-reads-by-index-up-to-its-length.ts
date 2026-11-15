// answers: with-library
// # `for (let i = 0; i < x.length; i++) .. x[i].v ..` over a value of which nothing is known: what is read is asked for a name, which bytes and texts do not hold: a list is expected: one test in front of the loop, the length and the elements read as a list's. Where what is read is compared with a text, a text is expected. Where it is only reckoned with, nothing is expected: it may as well be bytes. Whatever else comes (a text, a list with a hole, an object that is alike, bytes, a getter, nothing, a number, a frozen list, an accessor at an index, a class below Array, a list cut short within the loop) answers as plain.
// # f1 = sum, f2 = count, f3 = bytes
// # RUN(FORM): walk f1 f2 f3 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: [[list]]: {{*}} = ElemGet
// # FORM: = TypeTest [[list]] testedType=Array
// # FORM: = GetArrayLength
// # FORM: = GetArrayElement
// # FORM-LABEL: code f2:Body
// # FORM: [[text]]: {{*}} = ElemGet
// # FORM: = TypeTest [[text]] testedType=string
// # FORM-LABEL: code f3:Body
// # FORM: testedType=Buffer|Uint8Array
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 92 of 92 of 92
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const table: any = {};
function lay(name: string, what: unknown) { table[name] = what; }
function sum(name: string) { const x = table[name]; let s: any = 0; for (let i = 0; i < x.length; i++) s += x[i].v; return s; }
function count(name: string) { const x = table[name]; let n = 0; for (let i = 0; i < x.length; i++) if (x[i] === "e") n++; return n; }
function bytes(name: string) { const x = table[name]; let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function shrink(name: string) { const x = table[name]; let s = 0; for (let i = 0; i < x.length; i++) { s += x[i].v; if (i === 1) x.length = 3; } return s; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
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
