// Fields that an interface requires and no compiled code ever stores, like the brands of the TypeScript compiler's own nodes, take no room in the cell. Text that is evaluated at run time stores, reads, tests, lists, deletes and redefines them, and typed code sees what it sees in plain Bun.
// STATISTIC: FieldsOutOfLine >= 3
interface Branded { kind: number; _firstBrand: any; _secondBrand: any }
interface AstNode { kind: number; pos: number }
interface Identifier extends AstNode { kind: 1; text: string; _expressionBrand: any; _declarationBrand: any }
interface NumericLiteral extends AstNode { kind: 2; value: number; _expressionBrand: any }
type Expression = Identifier | NumericLiteral;

// Always the empty string, which the compiler cannot know: it never sees the text that is evaluated, so it sees no store of a brand.
const nothing = String(Date.now()).slice(64);
function evaluated(parameters: string, body: string) {
  return new Function(parameters, body + nothing) as (...values: any[]) => any;
}
const store = evaluated("o, key, value", "o[key] = value");
const storeFirst = evaluated("o, value", "o._firstBrand = value");
const storeSecond = evaluated("o, value", "o._secondBrand = value");
const storeFirstStrictly = evaluated("o, value", "'use strict'; o._firstBrand = value");
const removeFirst = evaluated("o", "return delete o._firstBrand");
const define = evaluated("o, key, descriptor", "Object.defineProperty(o, key, descriptor)");
const reparent = evaluated("o, prototype", "Object.setPrototypeOf(o, prototype)");
const told = evaluated("o", `
  const listed = [];
  for (const key in o) listed.push(key);
  return [o.kind, String(o._firstBrand), String(o._secondBrand), "_firstBrand" in o, "_secondBrand" in o, Object.hasOwn(o, "_firstBrand"), Object.keys(o).join(), listed.join(), JSON.stringify(o)].join(" ");
`);
const toldOfNode = evaluated("o", `
  return [String(o._expressionBrand), String(o._declarationBrand), "_expressionBrand" in o, "_declarationBrand" in o, Object.keys(o).join(), JSON.stringify(o)].join(" ");
`);

function seen(o: Branded): string {
  const listed: string[] = [];
  for (const key in o) listed.push(key);
  return [o.kind, String(o._firstBrand), String(o._secondBrand), "_firstBrand" in o, "_secondBrand" in o, Object.hasOwn(o, "_firstBrand"), Object.keys(o).join(), listed.join(), JSON.stringify(o)].join(" ");
}
function seenOfIdentifier(n: Identifier): string {
  return [String(n._expressionBrand), String(n._declarationBrand), "_expressionBrand" in n, "_declarationBrand" in n, Object.keys(n).join(), JSON.stringify(n)].join(" ");
}
function seenOfLiteral(n: NumericLiteral): string {
  return [n.kind, n.pos, n.value, String(n._expressionBrand), "_expressionBrand" in n, Object.keys(n).join(), JSON.stringify(n)].join(" ");
}
function brandOf(n: Expression): unknown { return n._expressionBrand; }
// Typed code and evaluated text say the same of an object.
function both(o: Branded): string {
  const typed = seen(o), untyped = told(o);
  return typed === untyped ? typed : typed + " BUT EVALUATED TEXT SEES " + untyped;
}
function bothOfIdentifier(n: Identifier): string {
  const typed = seenOfIdentifier(n), untyped = toldOfNode(n);
  return n.kind + " " + n.pos + " " + n.text + " " + (typed === untyped ? typed : typed + " BUT EVALUATED TEXT SEES " + untyped);
}
function thrownBy(run: () => unknown): string {
  try { run(); return "nothing thrown"; } catch (error) { return (error as Error).name; }
}

let count = 0;
function show(name: string, make: () => unknown): void {
  let out: string;
  try { out = String(make()); } catch (error) { out = "THROWN " + (error as Error).name + ": " + (error as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}

const record = (kind: number) => ({ kind }) as Branded;
function NodeObject(this: AstNode, kind: number, pos: number) { this.kind = kind; this.pos = pos; }
const NodeConstructor = NodeObject as any as new (kind: number, pos: number) => AstNode;
function createIdentifier(text: string, pos: number): Identifier { const node = new NodeConstructor(1, pos) as Identifier; node.text = text; return node; }
function createNumericLiteral(value: number, pos: number): NumericLiteral { const node = new NodeConstructor(2, pos) as NumericLiteral; node.value = value; return node; }
class Token implements Branded {
  kind: number;
  declare _firstBrand: any;
  declare _secondBrand: any;
  constructor(kind: number) { this.kind = kind; }
}

show("nothing is stored", () => both(record(1)));
show("the second field, then the first", () => { const o = record(2); storeSecond(o, "s"); storeFirst(o, 1.5); return both(o); });
show("undefined is a value", () => { const o = record(3); storeFirst(o, undefined); return both(o); });
show("undefined, then a value, then undefined", () => { const o = record(4); storeFirst(o, undefined); storeFirst(o, 7); const filled = both(o); storeFirst(o, undefined); return filled + " ; " + both(o); });
show("values of every kind", () => [0, -0, 2 ** 31, -(2 ** 31) - 1, 0.5, NaN, "", "text", true, false, null, undefined].map(value => { const o = record(5); storeFirst(o, value); return both(o); }).join(" ; "));
show("an object and an array", () => { const o = record(6); storeFirst(o, record(7)); storeSecond(o, [1, record(8)]); return both(o) + " " + o._firstBrand.kind + " " + o._secondBrand[1].kind; });
show("the object itself", () => { const o = record(9); storeSecond(o, o); return (o._secondBrand === o) + " " + Object.keys(o._secondBrand._secondBrand).join(); });
show("under a computed key", () => { const o = record(10); store(o, "_second" + "Brand", 2); store(o, "_firstBrand", 1); store(o, "other", 3); return both(o); });
show("deleted, then stored again", () => { const o = record(11); storeFirst(o, 1); storeSecond(o, 2); const removed = removeFirst(o), without = both(o); storeFirst(o, 3); return removed + " " + without + " ; " + both(o); });
show("deleted by compiled code", () => { const o = record(12); storeFirst(o, 1); storeSecond(o, 2); const removed = delete (o as any)._firstBrand; return removed + " " + both(o); });
show("deleted though it was never stored", () => { const o = record(13); return removeFirst(o) + " " + delete (o as any)._secondBrand + " " + both(o); });
show("a getter that is not listed", () => {
  const o = record(14);
  let calls = 0;
  define(o, "_firstBrand", { get() { calls++; return "got"; }, enumerable: false, configurable: true });
  return both(o) + " " + calls + " " + thrownBy(() => storeFirstStrictly(o, 1)) + " " + removeFirst(o) + " " + both(o);
});
show("a getter and a setter", () => {
  const o = record(15);
  const log: string[] = [];
  define(o, "_secondBrand", { get() { return "got"; }, set(value: any) { log.push("set " + value); }, enumerable: true, configurable: true });
  storeSecond(o, 1);
  return both(o) + " " + log.join();
});
show("read-only", () => {
  const o = record(16);
  define(o, "_firstBrand", { value: "fixed", writable: false, enumerable: true, configurable: false });
  storeFirst(o, "other");
  return thrownBy(() => storeFirstStrictly(o, "other")) + " " + removeFirst(o) + " " + both(o);
});
show("redefined after a store", () => { const o = record(17); storeFirst(o, 1); define(o, "_firstBrand", { enumerable: false }); storeFirst(o, 2); return both(o); });
show("frozen before the store", () => { const o = record(18); Object.freeze(o); storeFirst(o, 1); return thrownBy(() => storeFirstStrictly(o, 1)) + " " + Object.isFrozen(o) + " " + both(o); });
show("frozen after the store", () => { const o = record(19); storeFirst(o, 1); Object.freeze(o); storeFirst(o, 2); storeSecond(o, 3); return removeFirst(o) + " " + Object.isFrozen(o) + " " + both(o); });
show("not extensible before the store", () => { const o = record(20); Object.preventExtensions(o); storeFirst(o, 1); return thrownBy(() => storeFirstStrictly(o, 1)) + " " + Object.isExtensible(o) + " " + both(o); });
show("sealed after the store", () => { const o = record(21); storeFirst(o, 1); Object.seal(o); storeFirst(o, 2); storeSecond(o, 3); return removeFirst(o) + " " + Object.isSealed(o) + " " + both(o); });
show("inherited, then own, then inherited again", () => {
  const o = record(22);
  reparent(o, { _firstBrand: "inherited" });
  const inherited = both(o);
  storeFirst(o, "own");
  const own = both(o);
  return inherited + " ; " + own + " ; " + removeFirst(o) + " " + both(o);
});
show("an accessor on the prototype", () => {
  const o = record(23);
  const log: string[] = [];
  reparent(o, { get _firstBrand(): any { return "from the getter"; }, set _firstBrand(value: any) { log.push("set " + value); } });
  storeFirst(o, 1);
  return both(o) + " " + log.join();
});
show("read-only on the prototype", () => { const o = record(24); reparent(o, Object.freeze({ _firstBrand: "fixed" })); storeFirst(o, 1); return thrownBy(() => storeFirstStrictly(o, 1)) + " " + both(o); });
show("no prototype", () => { const o = record(25); reparent(o, null); storeSecond(o, 2); return both(o); });
// An allocation that copies lists what it copies, so no typed read sees a copy made by spread: the fields of the records would count as stored with those of the copy.
show("copies", () => {
  const o = record(26);
  storeSecond(o, "s");
  const spread = { ...o }, bare = { ...record(27) }, assigned = Object.assign(record(28), o);
  storeFirst(spread, "f");
  return [told(spread), told(bare), both(assigned), Object.entries(o).join(";"), Object.values(o).join(), Object.getOwnPropertyNames(o).join(), Reflect.ownKeys(o).join()].join(" | ");
});
show("the descriptor", () => { const o = record(29); storeFirst(o, 1); return JSON.stringify(Object.getOwnPropertyDescriptor(o, "_firstBrand")) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(o, "_secondBrand")); });

show("nodes without brands", () => bothOfIdentifier(createIdentifier("a", 1)) + " | " + seenOfLiteral(createNumericLiteral(2.5, 3)));
show("nodes with brands", () => {
  const name = createIdentifier("b", 4), number = createNumericLiteral(5, 6);
  store(name, "_declarationBrand", "d");
  store(name, "_expressionBrand", "e");
  store(number, "_expressionBrand", 7);
  return [bothOfIdentifier(name), seenOfLiteral(number), brandOf(name), brandOf(number), brandOf(createIdentifier("c", 8))].join(" | ");
});
show("a brand before the field of the node's own kind", () => { const node = new NodeConstructor(1, 9) as Identifier; store(node, "_expressionBrand", "early"); node.text = "late"; return bothOfIdentifier(node); });
show("a brand on a node of a kind that has none", () => { const node = new NodeConstructor(3, 10); store(node, "_expressionBrand", "stray"); return node.kind + " " + node.pos + " " + toldOfNode(node); });
show("a brand of the other kind", () => { const number = createNumericLiteral(11, 12); store(number, "_declarationBrand", "stray"); store(number, "text", "stray too"); return seenOfLiteral(number) + " " + toldOfNode(number); });
show("a frozen node", () => { const name = Object.freeze(createIdentifier("d", 13)); store(name, "_expressionBrand", 1); return bothOfIdentifier(name); });

show("instances of a class", () => { const token = new Token(30), fresh = both(token); storeSecond(token, 2); storeFirst(token, 1); return fresh + " ; " + both(token) + " " + (token instanceof Token); });
show("instances and records at one read", () => {
  const all: Branded[] = [record(31), new Token(32), record(33), new Token(34)];
  all.forEach((o, index) => { if (index & 1) storeFirst(o, index); else storeSecond(o, index); });
  return all.map(o => String(o._firstBrand) + "/" + String(o._secondBrand)).join();
});

show("many nodes, some of them branded", () => {
  const nodes: Identifier[] = [];
  for (let i = 0; i < 20000; i++) {
    const node = createIdentifier("n" + i, i);
    if (i % 3 === 0) store(node, "_expressionBrand", i);
    if (i % 7 === 0) store(node, "_declarationBrand", createIdentifier("held by " + i, -i));
    nodes.push(node);
  }
  let sum = 0, branded = 0, held = 0, length = 0;
  for (const node of nodes) {
    if ("_expressionBrand" in node) { branded++; sum += node._expressionBrand; }
    const other: Identifier | undefined = node._declarationBrand;
    if (other) { held += other.pos; length += other.text.length; }
  }
  return [sum, branded, held, length, Object.keys(nodes[0]).join(), Object.keys(nodes[1]).join(), Object.keys(nodes[3]).join(), Object.keys(nodes[7]).join()].join(" ");
});
