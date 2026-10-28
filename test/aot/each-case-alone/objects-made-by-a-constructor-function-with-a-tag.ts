// A constructor function stores a parameter into a field for which the types below its `this` declare distinct integer literals. Whatever layout the compiler picks by that tag, the object is what plain JavaScript makes.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare function structuredClone<T>(value: T): T;
const show = (v: unknown): string => typeof v === "number" && Object.is(v, -0) ? "-0" : typeof v === "bigint" ? String(v) + "n" : typeof v === "string" ? v : v === undefined || typeof v === "function" || typeof v === "symbol" ? typeof v : JSON.stringify(v, (k, each) => typeof each === "number" && each !== each ? "NaN" : each === undefined ? "undefined" : typeof each === "bigint" ? String(each) + "n" : each);
function t(name: string, f: () => unknown) { let r; try { r = show(f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r); }
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
t("every number as the tag", () => tags.map(tag => look(new Make(tag, 1, 2))));
t("every number as the tag, read where the types are declared", () => tags.map(tag => { const n = new Make(tag, 1, 4); return [show(kindOf(n)), span(n)]; }));
t("a tag written in the text", () => [look(new Make(80, 1, 2)), look(new Make(241, 1, 2)), look(new Make(5, 1, 2)), look(new Make(3, 1, 2)), look(new Make(1.5, 1, 2)), look(new Make(-0, 1, 2)), look(new Make(NaN, 1, 2))]);
t("no tag at all", () => [look(new Make(undefined)), look(new (Make as any)())]);
t("the member's own field is added", () => { const n = new Make(80, 1, 2) as Name; n.text = "a"; const b = new Make(241, 1, 2) as Block; b.list = [n]; return [look(n), textOf(n), look(b), listOf(b).length, JSON.stringify(b)]; });
t("fields are added in another order than they are declared", () => { const n = new Make(80, 1, 2) as Name; n.flags = 9; n.text = "a"; (n as any).late = 1; const m = new Make(80, 1, 2) as Name; (m as any).late = 1; m.text = "b"; m.flags = 8; return [Object.keys(n).join(), Object.keys(m).join(), JSON.stringify(n), JSON.stringify(m)]; });
t("another member's field is added", () => { const n = new Make(80, 1, 2) as any; n.list = [1]; n.text = "a"; return [look(n), listOf(n as Block), textOf(n as Name)]; });
t("the tag is changed later", () => { const n = new Make(80, 1, 2) as any; n.text = "a"; n.kind = 241; n.list = [n]; return [look(n), kindOf(n), listOf(n as Block).length, textOf(n as Name), n.kind === 241 ? (n as Block).list.length : -1]; });
t("the tag is changed to a value outside the table, to a fraction, to a text", () => [3, 1.5, "80", undefined].map(tag => { const n = new Make(80, 1, 2) as any; n.kind = tag; return [look(n), typeof n.kind]; }));
t("the tag is tested and the member's field is read", () => [80, 241, 5, 3].map(tag => { const n = new Make(tag, 1, 2) as Name | Block | Token; if (n.kind === 80) return "name " + String(n.text); if (n.kind === 241) return "block " + String(n.list); return "token " + String(n.kind); }));
t("the tag says one member and the fields are another's", () => { const n = new Make(241, 1, 2) as any; n.kind = 80; const m = n as Name | Block; return m.kind === 80 ? [typeof m.text, Object.keys(m).join()] : "block"; });
t("the tag is deleted and added again", () => { const n = new Make(80, 1, 2) as any; delete n.kind; const gone = look(n); n.kind = 80; return [gone, look(n)]; });
t("another new.target", () => { function Other() {} Other.prototype.mark = "other"; const n = Reflect.construct(Make, [80, 1, 2], Other) as any; return [Object.keys(n).join(), n.mark, n instanceof Make, n instanceof Other, Object.getPrototypeOf(n) === Other.prototype, n.kind]; });
t("the same new.target by Reflect.construct", () => look(Reflect.construct(Make, [80, 1, 2])));
t("a new.target whose prototype is no object", () => { function Other() {} (Other as any).prototype = 5; const n = Reflect.construct(Make, [80, 1, 2], Other) as any; return [Object.getPrototypeOf(n) === Object.prototype, n.kind]; });
t("called on an object that exists", () => { const o: any = { first: 1 }; const answer = Make.call(o, 80, 1, 2); return [answer, Object.keys(o).join(), o.kind, o instanceof Make]; });
t("called on an object made by it", () => { const n = new Make(80, 1, 2) as any; n.text = "a"; const answer = Make.call(n, 241, 3, 4); return [answer, look(n), n.text]; });
t("applied, and called on a frozen object", () => { const o: any = {}; Make.apply(o, [241, 1, 2]); let frozen; try { Make.call(Object.freeze({}), 80, 1, 2); frozen = "stored"; } catch (e) { frozen = (e as Error).name; } return [Object.keys(o).join(), frozen]; });
t("called without new", () => (Make as any)(80, 1, 2));
t("bound and constructed", () => { const Bound = Make.bind(null, 80); const n = new Bound(1, 2); return [look(n), n instanceof Bound]; });
t("a subclass", () => { class Sub extends (Make as any) { extra = 1; constructor(kind: number) { super(kind, 1, 2); } more() { return (this as any).kind; } } const n = new Sub(80) as any; return [Object.keys(n).join(), n instanceof Sub, n instanceof Make, Object.getPrototypeOf(n) === Sub.prototype, n.more(), n.extra]; });
t("a subclass made in evaluated text", () => { (globalThis as any).handed = Make; const n = unseen("new (class Sub extends handed { more() { return this.kind + 1; } })(80, 1, 2)"); return [Object.keys(n).join(), n instanceof Make, n.more(), kindOf(n), Object.getPrototypeOf(n) === Make.prototype]; });
t("constructed by evaluated text", () => { (globalThis as any).handed = Make; const n = unseen("new handed(241, 1, 2)"); return [look(n), kindOf(n), span(n)]; });
t("methods on the prototype", () => { Make.prototype.width = function (this: Item) { return this.end - this.pos; }; const n = new Make(80, 1, 5) as any; const w = n.width(); delete Make.prototype.width; return [w, typeof n.width]; });
t("the prototype is replaced", () => { const before = new Make(80, 1, 2); const old = Make.prototype; Make.prototype = { mark: "new" }; const after = new Make(80, 1, 2) as any; const r = [before instanceof Make, after instanceof Make, after.mark, Object.getPrototypeOf(before) === old, Object.getPrototypeOf(after) === Make.prototype, Object.keys(after).join()]; Make.prototype = old; return r; });
t("the prototype is no object", () => { const old = Make.prototype; Make.prototype = 5; const n = new Make(80, 1, 2); const r = [Object.getPrototypeOf(n) === Object.prototype, Object.keys(n).join(), kindOf(n)]; Make.prototype = old; return r; });
t("a setter for the tag above", () => { const seen: unknown[] = []; Object.defineProperty(Make.prototype, "kind", { set(v) { seen.push(v); }, get() { return "above"; }, configurable: true }); const n = new Make(80, 1, 2) as any; const r = [seen, Object.keys(n).join(), n.kind]; delete Make.prototype.kind; return [r, n.kind]; });
t("a read-only tag above", () => { Object.defineProperty(Make.prototype, "kind", { value: 1, writable: false, configurable: true }); let r; try { r = look(new Make(80, 1, 2)); } catch (e) { r = (e as Error).name; } delete Make.prototype.kind; return r; });
t("two objects are two objects", () => { const a = new Make(80, 1, 2), b = new Make(80, 1, 2); (a as any).own = 1; return [a === b, "own" in b, Object.keys(a).join(), Object.keys(b).join()]; });
t("many tags in a loop", () => { let sum = 0; const kept: Item[] = []; for (let i = 0; i < 300; i++) { const n = new Make(i % 7 === 0 ? 80 : i % 7 === 1 ? 241 : i % 7 === 2 ? 5 : i % 7 === 3 ? i : i % 7 === 4 ? i + 0.5 : i % 7 === 5 ? -0 : NaN, i, i + 2); kept.push(n); sum += span(n); } return [sum, kept.filter(n => n.kind === 80).length, kept.filter(n => n.kind !== n.kind).length, kept.filter(n => Object.is(n.kind, -0)).length, new Set(kept.map(n => Object.keys(n).join())).size]; });
t("copies are plain objects", () => { const n = new Make(80, 1, 2) as Name; n.text = "a"; const c: any = { ...n }, d = Object.assign({}, n), e = structuredClone(n) as any; return [c instanceof Make, Object.keys(c).join(), (d as any).kind, e instanceof Make, e.text, JSON.stringify(n)]; });
t("frozen, sealed, closed afterwards", () => [Object.freeze, Object.seal, Object.preventExtensions].map(close => { const n = close(new Make(80, 1, 2)) as any; let r; try { n.text = "a"; r = "added"; } catch (e) { r = (e as Error).name; } let s; try { n.kind = 241; s = n.kind; } catch (e) { s = (e as Error).name; } return [r, s, Object.keys(n).join()]; }));
function Freezing(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = kind; this.pos = pos; this.end = end; Object.freeze(this); }
t("frozen in the body", () => { const n = new (Freezing as any)(80, 1, 2); let r; try { n.text = "a"; r = "added"; } catch (e) { r = (e as Error).name; } return [r, Object.isFrozen(n), Object.keys(n).join(), kindOf(n)]; });
const leaked: any[] = [];
function Leaking(this: Item, kind: number, pos: number, end: number) { "use strict"; leaked.push(this, Object.keys(this).join(), (this as any).kind); this.kind = kind; leaked.push(Object.keys(this).join()); this.pos = pos; this.end = end; }
t("the body hands `this` out before the tag is stored", () => { const n = new (Leaking as any)(80, 1, 2); return [leaked[0] === n, leaked[1], leaked[2], leaked[3], Object.keys(n).join()]; });
function Throwing(this: Item, kind: number, pos: number, end: number) { "use strict"; leaked.push(this); this.kind = kind; if (pos < 0) throw new RangeError("pos"); this.pos = pos; this.end = end; }
t("the body throws after the tag is stored", () => { leaked.length = 0; let r; try { new (Throwing as any)(80, -1, 2); r = "made"; } catch (e) { r = (e as Error).name; } return [r, Object.keys(leaked[0]).join(), leaked[0].kind, leaked[0] instanceof (Throwing as any)]; });
function Changing(this: Item, kind: number, pos: number, end: number) { "use strict"; kind = kind + 161; this.kind = kind; this.pos = pos; this.end = end; }
t("the parameter is changed before it is stored", () => { const n = new (Changing as any)(80, 1, 2); return [n.kind, Object.keys(n).join(), n.kind === 241]; });
function Conditional(this: Item, kind: number, pos: number, end: number) { "use strict"; this.pos = pos; if (pos >= 0) this.kind = kind; this.end = end; }
t("the tag is stored under a condition, and not first", () => [new (Conditional as any)(80, 1, 2), new (Conditional as any)(80, -1, 2)].map(n => [Object.keys(n).join(), n.kind, "kind" in n]));
function Twice(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = kind; this.pos = pos; this.end = end; this.kind = pos; }
t("the tag is stored twice", () => { const n = new (Twice as any)(80, 241, 2); return [n.kind, Object.keys(n).join()]; });
function ByArguments(this: Item, kind: number, pos: number, end: number) { "use strict"; this.kind = arguments[0]; this.pos = arguments.length; this.end = end; }
t("the tag is taken from arguments", () => { const n = new (ByArguments as any)(80); return [n.kind, n.pos, n.end, Object.keys(n).join()]; });
function Returning(this: Item, kind: number, pos: number, end: number): any { "use strict"; this.kind = kind; this.pos = pos; this.end = end; if (kind === 241) return { other: true }; if (kind === 5) return 7; }
t("the body returns something", () => [80, 241, 5].map(tag => Object.keys(new (Returning as any)(tag, 1, 2)).join()));
t("new.target is seen by the body", () => { function Seeing(this: Item, kind: number) { "use strict"; this.kind = kind; this.pos = new.target === (Seeing as unknown) ? 1 : 0; this.end = 0; } function Other() {} return [new (Seeing as any)(80).pos, (Reflect.construct(Seeing, [80], Other) as any).pos]; });
t("the function is looked at as an object", () => [Make.prototype.constructor === Make, (Make as any).name, (Make as any).length, typeof Make, Object.getOwnPropertyNames(Make).sort().join()]);
t("a typed place gets the wrong member", () => { const b = new Make(241, 1, 2) as Block; b.list = []; const n = b as unknown as Name; return [typeof textOf(n), kindOf(n)]; });
t("a literal of the member's type beside the made ones", () => { const written: Name = { kind: 80, pos: 1, end: 2, text: "w" }; const made = new Make(80, 1, 2) as Name; made.text = "m"; return [written, made].map(n => [textOf(n), kindOf(n), span(n), n instanceof Make, Object.keys(n).join()]); });
