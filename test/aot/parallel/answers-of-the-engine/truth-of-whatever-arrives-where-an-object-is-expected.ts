// the truth of whatever arrives where `Node | undefined` is written: in a condition, under `!`, `&&`, `||`, as a value, in a loop, out of a field, out of a list, and where the proof is read behind it
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
class Node { kind = 7; parent: Node | undefined = undefined; }
class Other { kind = "other"; }
function inCondition(v: Node | undefined): number { return v ? 1 : 2; }
function negated(v: Node | undefined): boolean { return !v; }
function twiceNegated(v: Node | undefined): boolean { return !!v; }
function and(v: Node | undefined): unknown { return v && "and"; }
function or(v: Node | undefined): unknown { return v || "or"; }
function proofIsRead(v: Node | undefined): unknown { if (v) return v.kind; return "nothing"; }
function outOfField(holder: Node): number { return holder.parent ? 1 : 2; }
function outOfList(list: (Node | undefined)[], at: number): number { return list[at] ? 1 : 2; }
function inLoop(list: (Node | undefined)[]): number { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]) n += i + 1; return n; }
function whileThere(v: Node | undefined): number { let n = 0; while (v) { n++; v = v.parent; } return n; }
const chained = new Node(); chained.parent = new Node();
const values: any[] = [new Node(), chained, new Other(), {}, [], () => 1, undefined, null, 0, -0, NaN, 1, 0.5, "", "text", false, true, 0n, 1n, Symbol.iterator, new Proxy({}, {}), Object.create(null), new String(""), new Boolean(false)];
const functions: ((v: any) => unknown)[] = [inCondition, negated, twiceNegated, and, or, proofIsRead];
for (const f of functions) report(values.map(v => { const r = f(v); return typeof r === "object" || typeof r === "function" || typeof r === "symbol" || typeof r === "bigint" ? typeof r : Object.is(r, -0) ? "-0" : String(r); }).join(" "));
report(values.map(v => { const holder = new Node(); (holder as any).parent = v; return outOfField(holder); }).join(" "));
report(values.map((v, at) => outOfList(values, at)).join(" ") + " " + outOfList(values, 1000) + " " + outOfList(values, -1));
report(inLoop(values));
report([whileThere(chained), whileThere(undefined), whileThere(null as any), whileThere(0 as any), whileThere({ parent: { parent: "" } } as any)].join(" "));
report("end");
