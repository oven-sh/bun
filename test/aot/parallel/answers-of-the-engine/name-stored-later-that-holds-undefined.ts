// a maker stores undefined under optional names to give its objects one shape. Such a property takes no storage, and is there all the same: for `in`, hasOwnProperty, the lists of keys, a descriptor, a freeze, a deletion, and in front of a property of the same name above the object
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
interface Node { kind: number; jsDoc?: string[]; flowNode?: object; symbol?: object; locals?: object }
function Node(this: Node, kind: number) { this.kind = kind; }
const show = (o: any) => { let f = ""; for (const k in o) f += k + ","; return [Object.keys(o).join(","), f, JSON.stringify(o), Object.keys({ ...o }).join(","), Object.getOwnPropertyNames(o).join(","), Object.values(o).length].join("|"); };
const has = (o: any, k: string) => [k in o, Object.hasOwn(o, k), JSON.stringify(Object.getOwnPropertyDescriptor(o, k))].join(",");
function make(kind: number): Node { const node: Node = new (Node as any)(kind); node.jsDoc = undefined; if (kind & 1) node.flowNode = undefined; node.symbol = kind & 2 ? { s: kind } : undefined; if (kind & 4) node.locals = undefined; return node; }
for (let kind = 0; kind < 8; kind++) { const node = make(kind); report(show(node)); report([has(node, "jsDoc"), has(node, "flowNode"), has(node, "symbol"), has(node, "locals"), has(node, "never"), String(node.jsDoc), String(node.flowNode), String(node.locals)].join(" ")); }
for (let kind = 0; kind < 8; kind += 3) { const node = make(kind); node.flowNode = { f: 1 }; report(show(node) + has(node, "flowNode")); node.jsDoc = ["x"]; report(show(node)); node.jsDoc = undefined; report(show(node) + has(node, "jsDoc")); delete node.jsDoc; report(show(node) + has(node, "jsDoc")); node.jsDoc = undefined; report(show(node) + has(node, "jsDoc")); delete node.symbol; delete node.locals; report(show(node) + has(node, "symbol") + has(node, "locals")); }
function strictNamed(o: Node, v: any) { "use strict"; try { o.jsDoc = v; return "stored"; } catch (e: any) { return "threw"; } }
function strictOther(o: Node, v: any) { "use strict"; try { o.locals = v; return "stored"; } catch (e: any) { return "threw"; } }
for (let how = 0; how < 3; how++) { for (let kind = 0; kind < 8; kind += 3) { const node = make(kind); if (how === 0) Object.freeze(node); else if (how === 1) Object.seal(node); else Object.preventExtensions(node); report([strictNamed(node, ["y"]), strictNamed(node, undefined), strictOther(node, undefined), strictOther(node, {}), show(node), has(node, "jsDoc"), has(node, "locals"), Object.isFrozen(node), Object.isSealed(node)].join(" ")); } }
for (let kind = 0; kind < 4; kind++) { const node = make(kind); Object.defineProperty(node, "jsDoc", kind & 1 ? { enumerable: false } : { get() { return "got"; }, enumerable: true, configurable: true }); report(show(node) + has(node, "jsDoc") + String(node.jsDoc)); Object.defineProperty(node, "locals", { value: undefined, writable: true, enumerable: true, configurable: true }); report(show(node) + has(node, "locals")); }
class U { u = 1; }
function lay(o: U, turn: number) { const a = o as any; if (turn & 1) a.first = undefined; if (turn & 2) a.second = turn; if (turn & 4) a.first = turn & 8 ? undefined : "text"; }
function tell(o: U) { const a = o as any; let keys = ""; for (const k in a) keys += k + ","; return [String(a.first), String(a.second), "first" in a, "second" in a, keys].join(":"); }
for (let turn = 0; turn < 16; turn++) { const o = new U(); const before = tell(o); lay(o, turn); report(before + " " + tell(o)); }
function gone(o: U) { const a = o as any; a.first = undefined; const before = "first" in a; delete a.first; const between = "first" in a; a.second = 2; a.first = undefined; let keys = ""; for (const k in a) keys += k + ","; return [before, between, "first" in a, keys].join(":"); }
report(gone(new U()));
function inLoop(o: U, n: number) { const a = o as any; let seen = 0; for (let i = 0; i < n; i++) { if ("first" in a) seen++; if (i === 2) a.first = undefined; if (i === 5) a.first = i; if (a.first !== undefined) seen += 10; } return seen; }
report(inLoop(new U(), 9) + ":" + inLoop(new U(), 3));
Node.prototype.flowNode = "above";
const below = make(0);
const own = make(1);
report([String(below.flowNode), String(own.flowNode), has(below, "flowNode"), has(own, "flowNode")].join(" "));
report("end");
