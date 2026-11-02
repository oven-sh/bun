const which: string = process.argv[2] ?? "";
const rounds: number = Number(process.argv[3] ?? "64");

class WithInitializers { x = 0; y = 0; label = ""; constructor(x: number, y: number, label: string) { this.x = x; this.y = y; this.label = label; } }
class WithDeclarations { x: number; y: number; label: string; constructor(x: number, y: number, label: string) { this.x = x; this.y = y; this.label = label; } }
class WithParameterProperties { constructor(public x: number, public y: number, public label: string) {} }
class WithPrivateNames { #x: number; #y: number; constructor(x: number, y: number) { this.#x = x; this.#y = y; } sum() { return this.#x + this.#y; } }
class WithPrivateKeyword { private x: number; private y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class WithGetter { constructor(private w: number, private h: number) {} get area() { return this.w * this.h; } }
class WithMethod { constructor(private w: number, private h: number) {} area() { return this.w * this.h; } }
class WithArrowField { n = 3; add = (v: number) => v + this.n; }
class WithPlainMethod { n = 3; add(v: number) { return v + this.n; } }
class Above { a: number; constructor(a: number) { this.a = a; } }
class Below extends Above { b: number; constructor(a: number) { super(a); this.b = 2; } }
const inheritFrom = (function () {
  return function (d: any, b: any) {
    Object.setPrototypeOf(d, b);
    function Between(this: any) { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : ((Between.prototype = b.prototype), new (Between as any)());
  };
})();
const AboveForES5: any = (function () { function Above(this: any, a: number) { this.a = a; } return Above; })();
const BelowForES5: any = (function (_super: any) { inheritFrom(Below, _super); function Below(this: any, a: number) { var _this = _super.call(this, a) || this; _this.b = 2; return _this; } return Below; })(AboveForES5);

interface Inner { value: number; text: string }
interface Outer { inner: Inner; maybe?: Inner; list: number[]; a: number; b: number; c: number }
const outers: Outer[] = [];
for (let i = 0; i < 64; i++) outers.push({ inner: { value: i, text: "t" + i }, maybe: { value: i + 1, text: "m" + i }, list: [i, i + 1, i + 2], a: i, b: i * 2, c: i * 3 });
const maybeOuters: (Outer | undefined)[] = outers.slice();
const digits: string[] = outers.map(outer => String(outer.a * 37));
interface ListedBag { size: number; a: number; b: number }
interface OpenBag { size: number; [key: string]: number }
const listedBags: ListedBag[] = [];
const openBags: OpenBag[] = [];
for (let i = 0; i < 64; i++) { listedBags.push({ size: i, a: i + 1, b: 2 }); openBags.push({ size: i, a: i + 1, b: 2 }); }
type Level = "low" | "mid" | "high" | "top";
const levels: Level[] = ["low", "mid", "high", "top"];
const levelNames: string[] = ["low", "mid", "high", "top"];
const cutNames: string[] = ["xlow", "xmid", "xhigh", "xtop"].map(text => text.slice(1));
const cutLevels: Level[] = ["xlow", "xmid", "xhigh", "xtop"].map(text => text.slice(1) as Level);
const parsedNames: { level: string }[] = JSON.parse('[{"level":"low"},{"level":"mid"},{"level":"high"},{"level":"top"}]');
const parsedLevels: { level: Level }[] = JSON.parse('[{"level":"low"},{"level":"mid"},{"level":"high"},{"level":"top"}]');
const worthOfLevel: Record<Level, number> = { low: 1, mid: 2, high: 3, top: 4 };
const worthOfName: Record<string, number> = { low: 1, mid: 2, high: 3, top: 4 };
const getters: WithGetter[] = [], methods: WithMethod[] = [], arrows: WithArrowField[] = [], plains: WithPlainMethod[] = [], hashes: WithPrivateNames[] = [], keywords: WithPrivateKeyword[] = [];
for (let i = 0; i < 64; i++) { getters.push(new WithGetter(i, 2)); methods.push(new WithMethod(i, 2)); arrows.push(new WithArrowField()); plains.push(new WithPlainMethod()); hashes.push(new WithPrivateNames(i, 1)); keywords.push(new WithPrivateKeyword(i, 1)); }

function readsMembers(o: Outer) { return o.a + o.b + o.c; }
function readsPattern(o: Outer) { const { a, b, c } = o; return a + b + c; }
function takesPattern({ a, b, c }: Outer) { return a + b + c; }
function readsNestedMembers(o: Outer) { return o.inner.value + o.inner.text.length; }
function readsNestedPattern(o: Outer) { const { inner: { value, text } } = o; return value + text.length; }
function readsElements(o: Outer) { return o.list[0] + o.list[1] + o.list[2]; }
function readsArrayPattern(o: Outer) { const [x, y, z] = o.list; return x + y + z; }
function withDefaultParameter(v: number, step: number = 2) { return v + step; }
function withDefaultInBody(v: number, step?: number) { if (step === undefined) step = 2; return v + step; }
function three(a: number, b: number, c: number) { return a + b * 2 + c * 3; }
function rest(...values: number[]) { return values[0] + values[1] * 2 + values[2] * 3; }
const enum Kind { A, B, C, D }
function bySwitch(k: Kind) { switch (k) { case Kind.A: return 1; case Kind.B: return 20; case Kind.C: return 300; default: return 4000; } }
function byIfs(k: Kind) { if (k === Kind.A) return 1; if (k === Kind.B) return 20; if (k === Kind.C) return 300; return 4000; }
function* counting(n: number) { for (let i = 0; i < n; i++) yield i; }
const callback: ((v: number) => number) | undefined = rounds >= 0 ? v => v + 1 : undefined;

const loops: Record<string, (n: number) => number> = {
  "fields with initializers": n => { let s = 0; for (let i = 0; i < n; i++) { const p = new WithInitializers(i, 1, "l"); outersKeep = p; s += p.x + p.y; } return s; },
  "fields that are declared": n => { let s = 0; for (let i = 0; i < n; i++) { const p = new WithDeclarations(i, 1, "l"); outersKeep = p; s += p.x + p.y; } return s; },
  "parameter properties": n => { let s = 0; for (let i = 0; i < n; i++) { const p = new WithParameterProperties(i, 1, "l"); outersKeep = p; s += p.x + p.y; } return s; },
  "private keyword": n => { let s = 0; for (let i = 0; i < n; i++) s += keywords[i & 63].sum(); return s; },
  "private names": n => { let s = 0; for (let i = 0; i < n; i++) s += hashes[i & 63].sum(); return s; },
  "method": n => { let s = 0; for (let i = 0; i < n; i++) s += methods[i & 63].area(); return s; },
  "getter": n => { let s = 0; for (let i = 0; i < n; i++) s += getters[i & 63].area; return s; },
  "method of the class": n => { let s = 0; for (let i = 0; i < n; i++) s += plains[i & 63].add(i); return s; },
  "arrow function in a field": n => { let s = 0; for (let i = 0; i < n; i++) s += arrows[i & 63].add(i); return s; },
  "members": n => { let s = 0; for (let i = 0; i < n; i++) s += readsMembers(outers[i & 63]); return s; },
  "object pattern": n => { let s = 0; for (let i = 0; i < n; i++) s += readsPattern(outers[i & 63]); return s; },
  "object pattern as the parameter": n => { let s = 0; for (let i = 0; i < n; i++) s += takesPattern(outers[i & 63]); return s; },
  "nested members": n => { let s = 0; for (let i = 0; i < n; i++) s += readsNestedMembers(outers[i & 63]); return s; },
  "nested object pattern": n => { let s = 0; for (let i = 0; i < n; i++) s += readsNestedPattern(outers[i & 63]); return s; },
  "elements": n => { let s = 0; for (let i = 0; i < n; i++) s += readsElements(outers[i & 63]); return s; },
  "array pattern": n => { let s = 0; for (let i = 0; i < n; i++) s += readsArrayPattern(outers[i & 63]); return s; },
  "tests with &&": n => { let s = 0; for (let i = 0; i < n; i++) { const o = maybeOuters[i & 63]; s += (o && o.maybe && o.maybe.value) || 0; } return s; },
  "optional chain": n => { let s = 0; for (let i = 0; i < n; i++) s += maybeOuters[i & 63]?.maybe?.value || 0; return s; },
  "comparison with undefined and null": n => { let s = 0; for (let i = 0; i < n; i++) { const m = outers[i & 63].maybe; s += (m !== undefined && m !== null ? m : outers[0].inner).value; } return s; },
  "nullish coalescing": n => { let s = 0; for (let i = 0; i < n; i++) s += (outers[i & 63].maybe ?? outers[0].inner).value; return s; },
  "call behind a test": n => { let s = 0; for (let i = 0; i < n; i++) s += callback ? callback(i) : 0; return s; },
  "optional call": n => { let s = 0; for (let i = 0; i < n; i++) s += callback?.(i) ?? 0; return s; },
  "default in the body": n => { let s = 0; for (let i = 0; i < n; i++) s += withDefaultInBody(i) + withDefaultInBody(i, 3); return s; },
  "default parameter": n => { let s = 0; for (let i = 0; i < n; i++) s += withDefaultParameter(i) + withDefaultParameter(i, 3); return s; },
  "three parameters": n => { let s = 0; for (let i = 0; i < n; i++) s += three(i, 1, 2); return s; },
  "rest parameter": n => { let s = 0; for (let i = 0; i < n; i++) s += rest(i, 1, 2); return s; },
  "arguments one by one": n => { let s = 0; for (let i = 0; i < n; i++) { const l = outers[i & 63].list; s += three(l[0], l[1], l[2]); } return s; },
  "spread argument": n => { let s = 0; for (let i = 0; i < n; i++) s += three(...(outers[i & 63].list as [number, number, number])); return s; },
  "loop by index": n => { let s = 0; for (let i = 0; i < n; i++) { const l = outers[i & 63].list; for (let j = 0; j < l.length; j++) s += l[j]; } return s; },
  "for-of": n => { let s = 0; for (let i = 0; i < n; i++) for (const v of outers[i & 63].list) s += v; return s; },
  "forEach": n => { let s = 0; for (let i = 0; i < n; i++) outers[i & 63].list.forEach(v => { s += v; }); return s; },
  "literal that lists the members": n => { let s = 0; for (let i = 0; i < n; i++) { const v = outers[i & 63].inner; const c: Inner = { value: v.value, text: v.text }; outersKeep = c; s += c.value; } return s; },
  "literal with a spread": n => { let s = 0; for (let i = 0; i < n; i++) { const c: Inner = { ...outers[i & 63].inner }; outersKeep = c; s += c.value; } return s; },
  "concatenation": n => { let s = 0; for (let i = 0; i < n; i++) { const v = outers[i & 63].inner; s += (v.text + "-" + v.value + "!").length; } return s; },
  "template literal": n => { let s = 0; for (let i = 0; i < n; i++) { const v = outers[i & 63].inner; s += `${v.text}-${v.value}!`.length; } return s; },
  "chain of ifs": n => { let s = 0; for (let i = 0; i < n; i++) s += byIfs(i & 3); return s; },
  "switch": n => { let s = 0; for (let i = 0; i < n; i++) s += bySwitch(i & 3); return s; },
  "counted loop": n => { let s = 0; for (let i = 0; i < n; i++) s += i; return s; },
  "generator": n => { let s = 0; for (const i of counting(n)) s += i; return s; },
  "Number(text)": n => { let s = 0; for (let i = 0; i < n; i++) s += Number(digits[i & 63]); return s; },
  "+text": n => { let s = 0; for (let i = 0; i < n; i++) s += +digits[i & 63]; return s; },
  "template literal of a number": n => { let s = 0; for (let i = 0; i < n; i++) s += `${i & 1023}`.length; return s; },
  "String(number)": n => { let s = 0; for (let i = 0; i < n; i++) s += String(i & 1023).length; return s; },
  "typeof compared with undefined": n => { let s = 0; for (let i = 0; i < n; i++) s += typeof maybeOuters[i & 127] === "undefined" ? 1 : 2; return s; },
  "typeof above u": n => { let s = 0; for (let i = 0; i < n; i++) s += typeof maybeOuters[i & 127] > "u" ? 1 : 2; return s; },
  "class below a class": n => { let s = 0; for (let i = 0; i < n; i++) { const v = new Below(i & 7); s += v.a + v.b; } return s; },
  "class below a class as written for ES5": n => { let s = 0; for (let i = 0; i < n; i++) { const v = new BelowForES5(i & 7); s += v.a + v.b; } return s; },
  "names that the type of the literal lists": n => { let s = 0; for (let i = 0; i < n; i++) { const v = listedBags[i & 63]; s += v.size + v.a + v.b; } return s; },
  "names under the index signature of the type of the literal": n => { let s = 0; for (let i = 0; i < n; i++) { const v = openBags[i & 63]; s += v.size + v.a + v.b; } return s; },
  "keys out of a list of strings": n => { let s = 0; for (let i = 0; i < n; i++) s += worthOfName[levelNames[i & 3]]; return s; },
  "keys out of a list of a union of texts": n => { let s = 0; for (let i = 0; i < n; i++) s += worthOfLevel[levels[i & 3]]; return s; },
  "comparisons of a string out of a list": n => { let s = 0; for (let i = 0; i < n; i++) { const v = levelNames[i & 3]; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of one of a union of texts out of a list": n => { let s = 0; for (let i = 0; i < n; i++) { const v = levels[i & 3]; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of a string taken for one of a union of texts": n => { let s = 0; for (let i = 0; i < n; i++) { const v = levelNames[i & 3] as Level; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of a string cut out of another": n => { let s = 0; for (let i = 0; i < n; i++) { const v = cutNames[i & 3]; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of one of a union of texts cut out of another": n => { let s = 0; for (let i = 0; i < n; i++) { const v = cutLevels[i & 3]; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of a string out of parsed text": n => { let s = 0; for (let i = 0; i < n; i++) { const v = parsedNames[i & 3].level; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
  "comparisons of one of a union of texts out of parsed text": n => { let s = 0; for (let i = 0; i < n; i++) { const v = parsedLevels[i & 3].level; s += v === "low" ? 1 : v === "mid" ? 2 : 3; } return s; },
};
let outersKeep: unknown = undefined;

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
