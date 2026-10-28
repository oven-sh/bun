// A constructor function stores a parameter into a field for which the types below its `this` declare distinct integer literals. Whatever layout the compiler picks by that tag, the object is what plain JavaScript makes.
// Here the compiled program may refuse the value with a TypeError at the typed place. The third operand of `t` is what plain Bun answers: that answer and a TypeError print the same text, anything else prints itself. Where the answer is a list of answers, the same holds for each of them.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare function structuredClone<T>(value: T): T;
const show = (v: unknown): string => typeof v === "number" && Object.is(v, -0) ? "-0" : typeof v === "bigint" ? String(v) + "n" : typeof v === "string" ? v : v === undefined || typeof v === "function" || typeof v === "symbol" ? typeof v : JSON.stringify(v, (k, each) => typeof each === "number" && each !== each ? "NaN" : each === undefined ? "undefined" : typeof each === "bigint" ? String(each) + "n" : each);
const isAnswerOrRefusal = (ours: string, plain: string): boolean => { if (ours === plain || ours === "threw TypeError" || ours === '"TypeError"') return true; if (!ours.startsWith("[")) return false; const [mine, theirs]: unknown[][] = [JSON.parse(ours), JSON.parse(plain)]; return Array.isArray(theirs[0]) && mine.length === theirs.length && mine.every((each, i) => isAnswerOrRefusal(JSON.stringify(each), JSON.stringify(theirs[i]))); };
function t(name: string, f: () => unknown, plain: string) { let r; try { r = show(f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, isAnswerOrRefusal(r, plain) ? "the answer of plain Bun or a TypeError" : r); }
const never = process.argv.length > 99;
const unseen = eval;
interface Item { kind: number; pos: number; end: number; flags?: number }
interface Name extends Item { kind: 80; text: string }
interface Block extends Item { kind: 241; list: Item[] }
interface Token extends Item { kind: 5 | 6 | 7 }
function ItemObject(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = kind; this.pos = pos; this.end = end; }
type Maker = { new (kind: unknown, pos?: number, end?: number): Item; (this: unknown, kind: unknown, pos?: number, end?: number): void; prototype: any; call(self: unknown, ...rest: unknown[]): unknown; apply(self: unknown, rest: unknown[]): unknown; bind(self: unknown, ...rest: unknown[]): any };
const Make = ItemObject as unknown as Maker;
const look = (o: any) => [Object.keys(o).join(), Object.getPrototypeOf(o) === Make.prototype, o instanceof Make, o.constructor === Make, show(o.kind), o.pos, o.end, Object.isExtensible(o)];
const kindOf = (n: Item) => n.kind, textOf = (n: Name) => n.text, listOf = (n: Block) => n.list, span = (n: Item) => n.end - n.pos;
const tags: number[] = [80, 241, 5, 6, 7, 0, 1, -80, 79, 81, 2147483647, -2147483648, 2147483728, 4294967376, NaN, -0, 1.5, 80.5, Infinity];
const others: unknown[] = ["80", "", undefined, null, true, 80n, { valueOf() { return 80; } }, [80]];
const attempt = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).name; } };
function Freezing(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = kind; this.pos = pos; this.end = end; Object.freeze(this); }
const leaked: any[] = [];
function Leaking(this: Item, kind: number, pos: number, end: number) { "use strict"; leaked.push(this, Object.keys(this).join(), (this as any).kind); this.kind = kind; leaked.push(Object.keys(this).join()); this.pos = pos; this.end = end; }
function Throwing(this: Item, kind: number, pos: number, end: number) { "use strict"; leaked.push(this); this.kind = kind; if (pos < 0) throw new RangeError("pos"); this.pos = pos; this.end = end; }
function Changing(this: Item, kind: number, pos: number, end: number) { "use strict"; kind = kind + 161; this.kind = kind; this.pos = pos; this.end = end; }
function Conditional(this: Item, kind: number, pos: number, end: number) { "use strict"; this.pos = pos; if (pos >= 0) this.kind = kind; this.end = end; }
function Twice(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = kind; this.pos = pos; this.end = end; this.kind = pos; }
function ByArguments(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = arguments[0]; this.pos = arguments.length; this.end = end; }
function Returning(this: Item, kind: number, pos: number, end: number): any { "use strict"; this.kind = kind; this.pos = pos; this.end = end; if (kind === 241) return { other: true }; if (kind === 5) return 7; }
t("what is no number as the tag", () => others.map(tag => attempt(() => look(new Make(tag, 1, 2)))), '[["kind,pos,end",true,true,true,"80",1,2,true],["kind,pos,end",true,true,true,"",1,2,true],["kind,pos,end",true,true,true,"undefined",1,2,true],["kind,pos,end",true,true,true,"null",1,2,true],["kind,pos,end",true,true,true,"true",1,2,true],["kind,pos,end",true,true,true,"80n",1,2,true],["kind,pos,end",true,true,true,"{}",1,2,true],["kind,pos,end",true,true,true,"[80]",1,2,true]]');
t("what is no number as the tag, read where the types are declared", () => others.map(tag => attempt(() => { const n = new Make(tag, 1, 4); return [show(kindOf(n)), span(n)]; })), '[["80",3],["",3],["undefined",3],["null",3],["true",3],["80n",3],["{}",3],["[80]",3]]');
t("a text written as the tag", () => look(new Make("80", 1, 2)), '["kind,pos,end",true,true,true,"80",1,2,true]');
