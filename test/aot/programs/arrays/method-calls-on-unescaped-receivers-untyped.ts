
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 14; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 14 ? ",.. " + v.length : "") + "]" + (own.length ? "{" + own.join(",") + "}" : "") + (Object.getPrototypeOf(v) === Array.prototype ? "" : "^") + (Object.isFrozen(v) ? "F" : Object.isSealed(v) ? "S" : Object.isExtensible(v) ? "" : "X");
    }
    if (typeof v === "function") return "function";
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return Object.prototype.toString.call(v);
    if (typeof v === "number" && v === 0 && 1 / v < 0) return "-0";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const yes: boolean = Date.now() > 0;
const no: boolean = Date.now() < 0;
const holder: { it: any } = { it: undefined };
const given: number[] = [3, 1, 2];
function otherPrototype(m: string): any { const p: any = Object.create(Array.prototype); p[m] = function () { return "of another prototype"; }; return p; }
class Heir extends Array<number> { }
const meddlers: Array<(x: any, m: string) => void> = [
    (x, m) => { x[m] = () => "its own, given elsewhere"; },
    (x, m) => { Object.setPrototypeOf(x, otherPrototype(m)); },
    (x, m) => { },
];
function alterWhatIsHeld(m: string): void { holder.it[m] = () => "its own, through the holder"; }
function rest(...all: number[]): number[] { return all; }
const lines: string[] = [];
let memoized: any | undefined;
let calls = 0;
function fill(out: any): void { }
function fresh(): any { const out: any = []; for (const x of given) { calls++; if (x > 0) out.push(x); else if (x < -5) out.push(-x); } return out; }
function freshLiteral(): any { calls++; if (no) return [9, 9]; const out: any = [3, 1, 2]; for (let i = 0; i < 2; i++) calls += out.length; return out; }
function freshSpread(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return [...given]; }
function freshKeys(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return Object.values({ a: 3, b: 1, c: 2 }); }
function throughFresh(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return fresh(); }
function recursive(n: number): any { calls++; if (n > 0) return recursive(n - 1); const out: any = []; for (const x of given) out.push(x); return out; }
function kept(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } holder.it = out; return out; }
function keptOnOneRoad(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } if (yes) holder.it = out; return out; }
function keptByClosure(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } holder.it = { set map(f: unknown) { (out as any).map = f; }, set join(f: unknown) { (out as any).join = f; }, set push(f: unknown) { (out as any).push = f; } }; return out; }
function handedOn(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } meddlers[yes ? 2 : 0](out, "x"); return out; }
function memo(): any { calls++; for (let i = 0; i < 2; i++) calls += i; if (!memoized) memoized = [3, 1, 2]; holder.it = memoized; return memoized; }
function oneOfTwo(): any { calls++; for (let i = 0; i < 2; i++) calls += i; if (yes) { holder.it = given2; return given2; } return [3, 1, 2]; }
function alteredInside(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } (out as any).map = () => "its own, from the maker"; (out as any).join = () => "its own, from the maker"; return out; }
function anHeir(): any { calls++; for (let i = 0; i < 2; i++) calls += i; const out = new Heir(); out.push(3, 1, 2); return out; }
function frozenInside(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } return Object.freeze(out) as any; }
const given2: any = [3, 1, 2];

function c1(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing map: " + c1());
function c2(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing join: " + c2());
function c3(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing indexOf: " + c3());
function c4(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing slice: " + c4());
function c5(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing concat: " + c5());
function c6(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing push: " + c6());
function c7(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing pop: " + c7());
function c8(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing sort: " + c8());
function c9(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod map: " + c9());
function c10(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod join: " + c10());
function c11(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod indexOf: " + c11());
function c12(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod slice: " + c12());
function c13(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod concat: " + c13());
function c14(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod push: " + c14());
function c15(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod pop: " + c15());
function c16(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod sort: " + c16());
function c17(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["map"] = () => "its own by key";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey map: " + c17());
function c18(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["join"] = () => "its own by key";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey join: " + c18());
function c19(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["indexOf"] = () => "its own by key";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey indexOf: " + c19());
function c20(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["slice"] = () => "its own by key";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey slice: " + c20());
function c21(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["concat"] = () => "its own by key";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey concat: " + c21());
function c22(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["push"] = () => "its own by key";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey push: " + c22());
function c23(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["pop"] = () => "its own by key";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey pop: " + c23());
function c24(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)["sort"] = () => "its own by key";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByKey sort: " + c24());
function c25(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "map" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey map: " + c25());
function c26(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "join" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey join: " + c26());
function c27(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "indexOf" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey indexOf: " + c27());
function c28(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "slice" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey slice: " + c28());
function c29(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "concat" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey concat: " + c29());
function c30(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "push" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey push: " + c30());
function c31(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "pop" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey pop: " + c31());
function c32(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "sort" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey sort: " + c32());
function c33(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("map"));
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype map: " + c33());
function c34(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("join"));
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype join: " + c34());
function c35(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("indexOf"));
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype indexOf: " + c35());
function c36(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("slice"));
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype slice: " + c36());
function c37(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("concat"));
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype concat: " + c37());
function c38(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("push"));
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype push: " + c38());
function c39(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("pop"));
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype pop: " + c39());
function c40(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, otherPrototype("sort"));
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype sort: " + c40());
function c41(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("map"));
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect map: " + c41());
function c42(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("join"));
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect join: " + c42());
function c43(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("indexOf"));
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect indexOf: " + c43());
function c44(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("slice"));
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect slice: " + c44());
function c45(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("concat"));
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect concat: " + c45());
function c46(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("push"));
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect push: " + c46());
function c47(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("pop"));
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect pop: " + c47());
function c48(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("sort"));
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect sort: " + c48());
function c49(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName map: " + c49());
function c50(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName join: " + c50());
function c51(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName indexOf: " + c51());
function c52(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName slice: " + c52());
function c53(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName concat: " + c53());
function c54(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName push: " + c54());
function c55(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName pop: " + c55());
function c56(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName sort: " + c56());
function c57(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype map: " + c57());
function c58(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype join: " + c58());
function c59(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype indexOf: " + c59());
function c60(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype slice: " + c60());
function c61(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype concat: " + c61());
function c62(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype push: " + c62());
function c63(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype pop: " + c63());
function c64(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(a, null);
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal noPrototype sort: " + c64());
function c65(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "map", { value: () => "defined", configurable: true });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined map: " + c65());
function c66(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "join", { value: () => "defined", configurable: true });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined join: " + c66());
function c67(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "indexOf", { value: () => "defined", configurable: true });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined indexOf: " + c67());
function c68(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "slice", { value: () => "defined", configurable: true });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined slice: " + c68());
function c69(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "concat", { value: () => "defined", configurable: true });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined concat: " + c69());
function c70(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "push", { value: () => "defined", configurable: true });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined push: " + c70());
function c71(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "pop", { value: () => "defined", configurable: true });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined pop: " + c71());
function c72(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "sort", { value: () => "defined", configurable: true });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal defined sort: " + c72());
function c73(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "map", { get: () => () => "by a getter", configurable: true });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter map: " + c73());
function c74(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "join", { get: () => () => "by a getter", configurable: true });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter join: " + c74());
function c75(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "indexOf", { get: () => () => "by a getter", configurable: true });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter indexOf: " + c75());
function c76(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "slice", { get: () => () => "by a getter", configurable: true });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter slice: " + c76());
function c77(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "concat", { get: () => () => "by a getter", configurable: true });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter concat: " + c77());
function c78(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "push", { get: () => () => "by a getter", configurable: true });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter push: " + c78());
function c79(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "pop", { get: () => () => "by a getter", configurable: true });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter pop: " + c79());
function c80(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "sort", { get: () => () => "by a getter", configurable: true });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal definedGetter sort: " + c80());
function c81(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { map: () => "assigned" });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned map: " + c81());
function c82(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { join: () => "assigned" });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned join: " + c82());
function c83(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { indexOf: () => "assigned" });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned indexOf: " + c83());
function c84(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { slice: () => "assigned" });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned slice: " + c84());
function c85(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { concat: () => "assigned" });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned concat: " + c85());
function c86(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { push: () => "assigned" });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned push: " + c86());
function c87(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { pop: () => "assigned" });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned pop: " + c87());
function c88(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.assign(a, { sort: () => "assigned" });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal assigned sort: " + c88());
function c89(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement map: " + c89());
function c90(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement join: " + c90());
function c91(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement indexOf: " + c91());
function c92(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement slice: " + c92());
function c93(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement concat: " + c93());
function c94(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement push: " + c94());
function c95(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement pop: " + c95());
function c96(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, 0, { get: () => 42, configurable: true });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal getterElement sort: " + c96());
function c97(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen map: " + c97());
function c98(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen join: " + c98());
function c99(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen indexOf: " + c99());
function c100(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen slice: " + c100());
function c101(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen concat: " + c101());
function c102(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen push: " + c102());
function c103(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen pop: " + c103());
function c104(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.freeze(a);
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal frozen sort: " + c104());
function c105(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed map: " + c105());
function c106(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed join: " + c106());
function c107(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed indexOf: " + c107());
function c108(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed slice: " + c108());
function c109(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed concat: " + c109());
function c110(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed push: " + c110());
function c111(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed pop: " + c111());
function c112(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.seal(a);
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sealed sort: " + c112());
function c113(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible map: " + c113());
function c114(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible join: " + c114());
function c115(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible indexOf: " + c115());
function c116(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible slice: " + c116());
function c117(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible concat: " + c117());
function c118(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible push: " + c118());
function c119(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible pop: " + c119());
function c120(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.preventExtensions(a);
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notExtensible sort: " + c120());
function c121(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly map: " + c121());
function c122(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly join: " + c122());
function c123(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly indexOf: " + c123());
function c124(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly slice: " + c124());
function c125(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly concat: " + c125());
function c126(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly push: " + c126());
function c127(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly pop: " + c127());
function c128(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.defineProperty(a, "length", { writable: false });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthReadOnly sort: " + c128());
function c129(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter map: " + c129());
function c130(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter join: " + c130());
function c131(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter indexOf: " + c131());
function c132(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter slice: " + c132());
function c133(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter concat: " + c133());
function c134(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter push: " + c134());
function c135(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter pop: " + c135());
function c136(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 1;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal shorter sort: " + c136());
function c137(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer map: " + c137());
function c138(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer join: " + c138());
function c139(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer indexOf: " + c139());
function c140(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer slice: " + c140());
function c141(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer concat: " + c141());
function c142(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer push: " + c142());
function c143(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer pop: " + c143());
function c144(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = 6;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal longer sort: " + c144());
function c145(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement map: " + c145());
function c146(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement join: " + c146());
function c147(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement indexOf: " + c147());
function c148(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement slice: " + c148());
function c149(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement concat: " + c149());
function c150(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement push: " + c150());
function c151(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement pop: " + c151());
function c152(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement sort: " + c152());
function c153(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted map: " + c153());
function c154(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted join: " + c154());
function c155(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted indexOf: " + c155());
function c156(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted slice: " + c156());
function c157(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted concat: " + c157());
function c158(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted push: " + c158());
function c159(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted pop: " + c159());
function c160(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted sort: " + c160());
function c161(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName map: " + c161());
function c162(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName join: " + c162());
function c163(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName indexOf: " + c163());
function c164(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName slice: " + c164());
function c165(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName concat: " + c165());
function c166(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName push: " + c166());
function c167(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName pop: " + c167());
function c168(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).extra = 1;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal harmlessName sort: " + c168());
function c169(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey map: " + c169());
function c170(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey join: " + c170());
function c171(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey indexOf: " + c171());
function c172(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey slice: " + c172());
function c173(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey concat: " + c173());
function c174(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey push: " + c174());
function c175(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey pop: " + c175());
function c176(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[-1] = 5;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal negativeKey sort: " + c176());
function c177(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey map: " + c177());
function c178(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey join: " + c178());
function c179(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey indexOf: " + c179());
function c180(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey slice: " + c180());
function c181(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey concat: " + c181());
function c182(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey push: " + c182());
function c183(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey pop: " + c183());
function c184(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[1.5] = 5;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal fractionKey sort: " + c184());
function c185(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere map: " + c185());
function c186(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere join: " + c186());
function c187(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere indexOf: " + c187());
function c188(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere slice: " + c188());
function c189(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere concat: " + c189());
function c190(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere push: " + c190());
function c191(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere pop: " + c191());
function c192(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](a, "sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere sort: " + c192());
function c193(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype map: " + c193());
function c194(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype join: " + c194());
function c195(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype indexOf: " + c195());
function c196(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype slice: " + c196());
function c197(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype concat: " + c197());
function c198(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype push: " + c198());
function c199(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype pop: " + c199());
function c200(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 1 : 2](a, "sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewherePrototype sort: " + c200());
function c201(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing map: " + c201());
function c202(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing join: " + c202());
function c203(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing indexOf: " + c203());
function c204(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing slice: " + c204());
function c205(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing concat: " + c205());
function c206(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing push: " + c206());
function c207(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing pop: " + c207());
function c208(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? 2 : 0](a, "sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhereNothing sort: " + c208());
function c209(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held map: " + c209());
function c210(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held join: " + c210());
function c211(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held indexOf: " + c211());
function c212(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held slice: " + c212());
function c213(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held concat: " + c213());
function c214(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held push: " + c214());
function c215(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held pop: " + c215());
function c216(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held sort: " + c216());
function c217(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).map = () => "its own, by a closure"; }; alter();
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure map: " + c217());
function c218(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).join = () => "its own, by a closure"; }; alter();
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure join: " + c218());
function c219(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).indexOf = () => "its own, by a closure"; }; alter();
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure indexOf: " + c219());
function c220(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).slice = () => "its own, by a closure"; }; alter();
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure slice: " + c220());
function c221(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).concat = () => "its own, by a closure"; }; alter();
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure concat: " + c221());
function c222(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).push = () => "its own, by a closure"; }; alter();
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure push: " + c222());
function c223(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).pop = () => "its own, by a closure"; }; alter();
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure pop: " + c223());
function c224(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).sort = () => "its own, by a closure"; }; alter();
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure sort: " + c224());
function c225(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.map = () => "its own, by a callback"; });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback map: " + c225());
function c226(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.join = () => "its own, by a callback"; });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback join: " + c226());
function c227(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.indexOf = () => "its own, by a callback"; });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback indexOf: " + c227());
function c228(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.slice = () => "its own, by a callback"; });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback slice: " + c228());
function c229(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.concat = () => "its own, by a callback"; });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback concat: " + c229());
function c230(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.push = () => "its own, by a callback"; });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback push: " + c230());
function c231(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.pop = () => "its own, by a callback"; });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback pop: " + c231());
function c232(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.sort = () => "its own, by a callback"; });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback sort: " + c232());
function c233(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.map = () => "its own, by a callback of map"; return x; });
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap map: " + c233());
function c234(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.join = () => "its own, by a callback of map"; return x; });
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap join: " + c234());
function c235(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.indexOf = () => "its own, by a callback of map"; return x; });
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap indexOf: " + c235());
function c236(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.slice = () => "its own, by a callback of map"; return x; });
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap slice: " + c236());
function c237(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.concat = () => "its own, by a callback of map"; return x; });
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap concat: " + c237());
function c238(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.push = () => "its own, by a callback of map"; return x; });
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap push: " + c238());
function c239(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.pop = () => "its own, by a callback of map"; return x; });
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap pop: " + c239());
function c240(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.sort = () => "its own, by a callback of map"; return x; });
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap sort: " + c240());
function c241(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species map: " + c241());
function c242(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species join: " + c242());
function c243(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species indexOf: " + c243());
function c244(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species slice: " + c244());
function c245(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species concat: " + c245());
function c246(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species push: " + c246());
function c247(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species pop: " + c247());
function c248(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = Heir;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal species sort: " + c248());
function c249(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject map: " + c249());
function c250(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject join: " + c250());
function c251(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject indexOf: " + c251());
function c252(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject slice: " + c252());
function c253(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject concat: " + c253());
function c254(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject push: " + c254());
function c255(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject pop: " + c255());
function c256(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).constructor = { [Symbol.species]: Heir };
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal speciesObject sort: " + c256());
function c257(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable map: " + c257());
function c258(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable join: " + c258());
function c259(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable indexOf: " + c259());
function c260(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable slice: " + c260());
function c261(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable concat: " + c261());
function c262(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable push: " + c262());
function c263(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable pop: " + c263());
function c264(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.isConcatSpreadable] = false;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notSpreadable sort: " + c264());
function c265(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator map: " + c265());
function c266(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator join: " + c266());
function c267(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator indexOf: " + c267());
function c268(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator slice: " + c268());
function c269(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator concat: " + c269());
function c270(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator push: " + c270());
function c271(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator pop: " + c271());
function c272(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)[Symbol.iterator] = function* () { yield 99; };
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownIterator sort: " + c272());
function c273(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).map = () => "its own, on one road";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes map: " + c273());
function c274(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).join = () => "its own, on one road";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes join: " + c274());
function c275(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).indexOf = () => "its own, on one road";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes indexOf: " + c275());
function c276(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).slice = () => "its own, on one road";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes slice: " + c276());
function c277(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).concat = () => "its own, on one road";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes concat: " + c277());
function c278(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).push = () => "its own, on one road";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes push: " + c278());
function c279(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).pop = () => "its own, on one road";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes pop: " + c279());
function c280(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).sort = () => "its own, on one road";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes sort: " + c280());
function c281(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).map = () => "never";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo map: " + c281());
function c282(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).join = () => "never";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo join: " + c282());
function c283(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).indexOf = () => "never";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo indexOf: " + c283());
function c284(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).slice = () => "never";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo slice: " + c284());
function c285(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).concat = () => "never";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo concat: " + c285());
function c286(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).push = () => "never";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo push: " + c286());
function c287(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).pop = () => "never";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo pop: " + c287());
function c288(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).sort = () => "never";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo sort: " + c288());
function c289(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).map = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry map: " + c289());
function c290(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).join = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry join: " + c290());
function c291(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).indexOf = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry indexOf: " + c291());
function c292(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).slice = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry slice: " + c292());
function c293(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).concat = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry concat: " + c293());
function c294(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).push = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry push: " + c294());
function c295(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).pop = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry pop: " + c295());
function c296(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).sort = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry sort: " + c296());
function c297(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.map = () => "its own, through what sort returns";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort map: " + c297());
function c298(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.join = () => "its own, through what sort returns";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort join: " + c298());
function c299(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.indexOf = () => "its own, through what sort returns";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort indexOf: " + c299());
function c300(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.slice = () => "its own, through what sort returns";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort slice: " + c300());
function c301(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.concat = () => "its own, through what sort returns";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort concat: " + c301());
function c302(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.push = () => "its own, through what sort returns";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort push: " + c302());
function c303(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.pop = () => "its own, through what sort returns";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort pop: " + c303());
function c304(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same: any = a.sort(); same.sort = () => "its own, through what sort returns";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughSort sort: " + c304());
function c305(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { map: unknown }; same.map = () => "its own, through a cast";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast map: " + c305());
function c306(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { join: unknown }; same.join = () => "its own, through a cast";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast join: " + c306());
function c307(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { indexOf: unknown }; same.indexOf = () => "its own, through a cast";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast indexOf: " + c307());
function c308(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { slice: unknown }; same.slice = () => "its own, through a cast";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast slice: " + c308());
function c309(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { concat: unknown }; same.concat = () => "its own, through a cast";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast concat: " + c309());
function c310(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { push: unknown }; same.push = () => "its own, through a cast";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast push: " + c310());
function c311(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { pop: unknown }; same.pop = () => "its own, through a cast";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast pop: " + c311());
function c312(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const same = a as unknown as { sort: unknown }; same.sort = () => "its own, through a cast";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal throughCast sort: " + c312());
function c313(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].map = () => "its own, through an array";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray map: " + c313());
function c314(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].join = () => "its own, through an array";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray join: " + c314());
function c315(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].indexOf = () => "its own, through an array";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray indexOf: " + c315());
function c316(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].slice = () => "its own, through an array";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray slice: " + c316());
function c317(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].concat = () => "its own, through an array";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray concat: " + c317());
function c318(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].push = () => "its own, through an array";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray push: " + c318());
function c319(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].pop = () => "its own, through an array";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray pop: " + c319());
function c320(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any[] = [a]; box[0].sort = () => "its own, through an array";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inArray sort: " + c320());
function c321(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.map = () => "its own, through an object";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject map: " + c321());
function c322(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.join = () => "its own, through an object";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject join: " + c322());
function c323(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.indexOf = () => "its own, through an object";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject indexOf: " + c323());
function c324(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.slice = () => "its own, through an object";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject slice: " + c324());
function c325(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.concat = () => "its own, through an object";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject concat: " + c325());
function c326(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.push = () => "its own, through an object";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject push: " + c326());
function c327(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.pop = () => "its own, through an object";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject pop: " + c327());
function c328(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const box: any = { a }; box.a.sort = () => "its own, through an object";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inObject sort: " + c328());
function c329(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated map: " + c329());
function c330(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated join: " + c330());
function c331(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated indexOf: " + c331());
function c332(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated slice: " + c332());
function c333(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated concat: " + c333());
function c334(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated push: " + c334());
function c335(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated pop: " + c335());
function c336(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) sum += x;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated sort: " + c336());
function c337(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).map = () => "its own, in a loop over it"; }
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering map: " + c337());
function c338(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).join = () => "its own, in a loop over it"; }
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering join: " + c338());
function c339(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).indexOf = () => "its own, in a loop over it"; }
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering indexOf: " + c339());
function c340(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).slice = () => "its own, in a loop over it"; }
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering slice: " + c340());
function c341(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).concat = () => "its own, in a loop over it"; }
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering concat: " + c341());
function c342(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).push = () => "its own, in a loop over it"; }
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering push: " + c342());
function c343(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).pop = () => "its own, in a loop over it"; }
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering pop: " + c343());
function c344(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) { if (x === 1) (a as any).sort = () => "its own, in a loop over it"; }
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iteratedAltering sort: " + c344());
function c345(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared map: " + c345());
function c346(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared join: " + c346());
function c347(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared indexOf: " + c347());
function c348(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared slice: " + c348());
function c349(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared concat: " + c349());
function c350(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared push: " + c350());
function c351(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared pop: " + c351());
function c352(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ((a as unknown) === (given as unknown)) sum++;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal compared sort: " + c352());
function c353(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf map: " + c353());
function c354(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf join: " + c354());
function c355(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf indexOf: " + c355());
function c356(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf slice: " + c356());
function c357(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf concat: " + c357());
function c358(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf push: " + c358());
function c359(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf pop: " + c359());
function c360(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (typeof a === "object") sum++;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal typeOf sort: " + c360());
function c361(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName map: " + c361());
function c362(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName join: " + c362());
function c363(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName indexOf: " + c363());
function c364(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName slice: " + c364());
function c365(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName concat: " + c365());
function c366(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName push: " + c366());
function c367(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName pop: " + c367());
function c368(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if ("length" in a) sum++;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inByName sort: " + c368());
function c369(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy map: " + c369());
function c370(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy join: " + c370());
function c371(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy indexOf: " + c371());
function c372(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy slice: " + c372());
function c373(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy concat: " + c373());
function c374(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy push: " + c374());
function c375(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy pop: " + c375());
function c376(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy sort: " + c376());
function c377(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil map: " + c377());
function c378(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil join: " + c378());
function c379(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil indexOf: " + c379());
function c380(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil slice: " + c380());
function c381(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil concat: " + c381());
function c382(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil push: " + c382());
function c383(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil pop: " + c383());
function c384(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a != null) sum++;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal notNil sort: " + c384());
function c385(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray map: " + c385());
function c386(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray join: " + c386());
function c387(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray indexOf: " + c387());
function c388(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray slice: " + c388());
function c389(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray concat: " + c389());
function c390(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray push: " + c390());
function c391(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray pop: " + c391());
function c392(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (Array.isArray(a)) sum++;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal isArray sort: " + c392());
function c393(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead map: " + c393());
function c394(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead join: " + c394());
function c395(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead indexOf: " + c395());
function c396(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead slice: " + c396());
function c397(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead concat: " + c397());
function c398(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead push: " + c398());
function c399(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead pop: " + c399());
function c400(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a.length;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal lengthRead sort: " + c400());
function c401(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead map: " + c401());
function c402(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead join: " + c402());
function c403(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead indexOf: " + c403());
function c404(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead slice: " + c404());
function c405(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead concat: " + c405());
function c406(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead push: " + c406());
function c407(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead pop: " + c407());
function c408(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a[0];
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementRead sort: " + c408());
function c409(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored map: " + c409());
function c410(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored join: " + c410());
function c411(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored indexOf: " + c411());
function c412(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored slice: " + c412());
function c413(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored concat: " + c413());
function c414(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored push: " + c414());
function c415(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored pop: " + c415());
function c416(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored sort: " + c416());
function c417(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore map: " + c417());
function c418(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore join: " + c418());
function c419(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore indexOf: " + c419());
function c420(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore slice: " + c420());
function c421(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore concat: " + c421());
function c422(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore push: " + c422());
function c423(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore pop: " + c423());
function c424(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.push(4);
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal pushedBefore sort: " + c424());
function c425(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore map: " + c425());
function c426(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore join: " + c426());
function c427(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore indexOf: " + c427());
function c428(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore slice: " + c428());
function c429(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore concat: " + c429());
function c430(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore push: " + c430());
function c431(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore pop: " + c431());
function c432(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.sort();
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal sortedBefore sort: " + c432());
function c433(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing map: " + c433());
function c434(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing join: " + c434());
function c435(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing indexOf: " + c435());
function c436(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing slice: " + c436());
function c437(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing concat: " + c437());
function c438(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing push: " + c438());
function c439(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing pop: " + c439());
function c440(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing sort: " + c440());
function c441(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod map: " + c441());
function c442(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod join: " + c442());
function c443(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod indexOf: " + c443());
function c444(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod slice: " + c444());
function c445(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod concat: " + c445());
function c446(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod push: " + c446());
function c447(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod pop: " + c447());
function c448(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod sort: " + c448());
function c449(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing map: " + c449());
function c450(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing join: " + c450());
function c451(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing indexOf: " + c451());
function c452(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing slice: " + c452());
function c453(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing concat: " + c453());
function c454(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing push: " + c454());
function c455(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing pop: " + c455());
function c456(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing sort: " + c456());
function c457(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod map: " + c457());
function c458(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod join: " + c458());
function c459(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod indexOf: " + c459());
function c460(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod slice: " + c460());
function c461(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod concat: " + c461());
function c462(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod push: " + c462());
function c463(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod pop: " + c463());
function c464(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod sort: " + c464());
function c465(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing map: " + c465());
function c466(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing join: " + c466());
function c467(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing indexOf: " + c467());
function c468(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing slice: " + c468());
function c469(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing concat: " + c469());
function c470(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing push: " + c470());
function c471(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing pop: " + c471());
function c472(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing sort: " + c472());
function c473(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod map: " + c473());
function c474(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod join: " + c474());
function c475(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod indexOf: " + c475());
function c476(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod slice: " + c476());
function c477(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod concat: " + c477());
function c478(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod push: " + c478());
function c479(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod pop: " + c479());
function c480(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod sort: " + c480());
function c481(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing map: " + c481());
function c482(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing join: " + c482());
function c483(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing indexOf: " + c483());
function c484(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing slice: " + c484());
function c485(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing concat: " + c485());
function c486(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing push: " + c486());
function c487(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing pop: " + c487());
function c488(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing sort: " + c488());
function c489(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod map: " + c489());
function c490(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod join: " + c490());
function c491(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod indexOf: " + c491());
function c492(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod slice: " + c492());
function c493(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod concat: " + c493());
function c494(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod push: " + c494());
function c495(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod pop: " + c495());
function c496(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod sort: " + c496());
function c497(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing map: " + c497());
function c498(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing join: " + c498());
function c499(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing indexOf: " + c499());
function c500(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing slice: " + c500());
function c501(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing concat: " + c501());
function c502(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing push: " + c502());
function c503(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing pop: " + c503());
function c504(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing sort: " + c504());
function c505(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod map: " + c505());
function c506(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod join: " + c506());
function c507(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod indexOf: " + c507());
function c508(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod slice: " + c508());
function c509(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod concat: " + c509());
function c510(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod push: " + c510());
function c511(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod pop: " + c511());
function c512(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod sort: " + c512());
function c513(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing map: " + c513());
function c514(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing join: " + c514());
function c515(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing indexOf: " + c515());
function c516(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing slice: " + c516());
function c517(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing concat: " + c517());
function c518(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing push: " + c518());
function c519(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing pop: " + c519());
function c520(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing sort: " + c520());
function c521(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod map: " + c521());
function c522(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod join: " + c522());
function c523(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod indexOf: " + c523());
function c524(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod slice: " + c524());
function c525(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod concat: " + c525());
function c526(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod push: " + c526());
function c527(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod pop: " + c527());
function c528(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod sort: " + c528());
function c529(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing map: " + c529());
function c530(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing join: " + c530());
function c531(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing indexOf: " + c531());
function c532(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing slice: " + c532());
function c533(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing concat: " + c533());
function c534(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing push: " + c534());
function c535(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing pop: " + c535());
function c536(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing sort: " + c536());
function c537(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod map: " + c537());
function c538(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod join: " + c538());
function c539(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod indexOf: " + c539());
function c540(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod slice: " + c540());
function c541(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod concat: " + c541());
function c542(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod push: " + c542());
function c543(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod pop: " + c543());
function c544(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod sort: " + c544());
function c545(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing map: " + c545());
function c546(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing join: " + c546());
function c547(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing indexOf: " + c547());
function c548(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing slice: " + c548());
function c549(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing concat: " + c549());
function c550(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing push: " + c550());
function c551(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing pop: " + c551());
function c552(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing sort: " + c552());
function c553(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod map: " + c553());
function c554(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod join: " + c554());
function c555(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod indexOf: " + c555());
function c556(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod slice: " + c556());
function c557(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod concat: " + c557());
function c558(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod push: " + c558());
function c559(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod pop: " + c559());
function c560(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod sort: " + c560());
function c561(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing map: " + c561());
function c562(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing join: " + c562());
function c563(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing indexOf: " + c563());
function c564(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing slice: " + c564());
function c565(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing concat: " + c565());
function c566(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing push: " + c566());
function c567(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing pop: " + c567());
function c568(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing sort: " + c568());
function c569(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod map: " + c569());
function c570(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod join: " + c570());
function c571(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod indexOf: " + c571());
function c572(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod slice: " + c572());
function c573(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod concat: " + c573());
function c574(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod push: " + c574());
function c575(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod pop: " + c575());
function c576(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod sort: " + c576());
function c577(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing map: " + c577());
function c578(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing join: " + c578());
function c579(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing indexOf: " + c579());
function c580(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing slice: " + c580());
function c581(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing concat: " + c581());
function c582(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing push: " + c582());
function c583(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing pop: " + c583());
function c584(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing sort: " + c584());
function c585(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod map: " + c585());
function c586(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod join: " + c586());
function c587(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod indexOf: " + c587());
function c588(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod slice: " + c588());
function c589(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod concat: " + c589());
function c590(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod push: " + c590());
function c591(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod pop: " + c591());
function c592(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod sort: " + c592());
function c593(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing map: " + c593());
function c594(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing join: " + c594());
function c595(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing indexOf: " + c595());
function c596(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing slice: " + c596());
function c597(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing concat: " + c597());
function c598(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing push: " + c598());
function c599(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing pop: " + c599());
function c600(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing sort: " + c600());
function c601(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod map: " + c601());
function c602(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod join: " + c602());
function c603(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod indexOf: " + c603());
function c604(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod slice: " + c604());
function c605(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod concat: " + c605());
function c606(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod push: " + c606());
function c607(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod pop: " + c607());
function c608(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod sort: " + c608());
function c609(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing map: " + c609());
function c610(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing join: " + c610());
function c611(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing indexOf: " + c611());
function c612(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing slice: " + c612());
function c613(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing concat: " + c613());
function c614(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing push: " + c614());
function c615(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing pop: " + c615());
function c616(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing sort: " + c616());
function c617(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod map: " + c617());
function c618(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod join: " + c618());
function c619(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod indexOf: " + c619());
function c620(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod slice: " + c620());
function c621(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod concat: " + c621());
function c622(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod push: " + c622());
function c623(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod pop: " + c623());
function c624(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod sort: " + c624());
function c625(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing map: " + c625());
function c626(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing join: " + c626());
function c627(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing indexOf: " + c627());
function c628(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing slice: " + c628());
function c629(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing concat: " + c629());
function c630(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing push: " + c630());
function c631(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing pop: " + c631());
function c632(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing sort: " + c632());
function c633(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod map: " + c633());
function c634(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod join: " + c634());
function c635(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod indexOf: " + c635());
function c636(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod slice: " + c636());
function c637(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod concat: " + c637());
function c638(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod push: " + c638());
function c639(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod pop: " + c639());
function c640(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod sort: " + c640());
function c641(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing map: " + c641());
function c642(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing join: " + c642());
function c643(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing indexOf: " + c643());
function c644(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing slice: " + c644());
function c645(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing concat: " + c645());
function c646(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing push: " + c646());
function c647(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing pop: " + c647());
function c648(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing sort: " + c648());
function c649(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod map: " + c649());
function c650(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod join: " + c650());
function c651(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod indexOf: " + c651());
function c652(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod slice: " + c652());
function c653(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod concat: " + c653());
function c654(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod push: " + c654());
function c655(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod pop: " + c655());
function c656(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod sort: " + c656());
function c657(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing map: " + c657());
function c658(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing join: " + c658());
function c659(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing indexOf: " + c659());
function c660(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing slice: " + c660());
function c661(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing concat: " + c661());
function c662(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing push: " + c662());
function c663(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing pop: " + c663());
function c664(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing sort: " + c664());
function c665(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).map = () => "its own";
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod map: " + c665());
function c666(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).join = () => "its own";
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod join: " + c666());
function c667(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).indexOf = () => "its own";
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod indexOf: " + c667());
function c668(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).slice = () => "its own";
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod slice: " + c668());
function c669(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).concat = () => "its own";
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod concat: " + c669());
function c670(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).push = () => "its own";
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod push: " + c670());
function c671(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).pop = () => "its own";
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod pop: " + c671());
function c672(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).sort = () => "its own";
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod sort: " + c672());
function c673(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing map: " + c673());
function c674(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing join: " + c674());
function c675(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing indexOf: " + c675());
function c676(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing slice: " + c676());
function c677(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing concat: " + c677());
function c678(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing push: " + c678());
function c679(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing pop: " + c679());
function c680(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing sort: " + c680());
function c681(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld map: " + c681());
function c682(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld join: " + c682());
function c683(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld indexOf: " + c683());
function c684(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld slice: " + c684());
function c685(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld concat: " + c685());
function c686(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld push: " + c686());
function c687(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld pop: " + c687());
function c688(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld sort: " + c688());
function c689(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing map: " + c689());
function c690(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing join: " + c690());
function c691(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing indexOf: " + c691());
function c692(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing slice: " + c692());
function c693(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing concat: " + c693());
function c694(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing push: " + c694());
function c695(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing pop: " + c695());
function c696(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing sort: " + c696());
function c697(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld map: " + c697());
function c698(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld join: " + c698());
function c699(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld indexOf: " + c699());
function c700(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld slice: " + c700());
function c701(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld concat: " + c701());
function c702(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld push: " + c702());
function c703(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld pop: " + c703());
function c704(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld sort: " + c704());
function c705(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing map: " + c705());
function c706(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing join: " + c706());
function c707(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing indexOf: " + c707());
function c708(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing slice: " + c708());
function c709(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing concat: " + c709());
function c710(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing push: " + c710());
function c711(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing pop: " + c711());
function c712(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing sort: " + c712());
function c713(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld map: " + c713());
function c714(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld join: " + c714());
function c715(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld indexOf: " + c715());
function c716(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld slice: " + c716());
function c717(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld concat: " + c717());
function c718(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld push: " + c718());
function c719(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld pop: " + c719());
function c720(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld sort: " + c720());
function c721(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing map: " + c721());
function c722(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing join: " + c722());
function c723(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing indexOf: " + c723());
function c724(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing slice: " + c724());
function c725(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing concat: " + c725());
function c726(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing push: " + c726());
function c727(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing pop: " + c727());
function c728(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing sort: " + c728());
function c729(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld map: " + c729());
function c730(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld join: " + c730());
function c731(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld indexOf: " + c731());
function c732(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld slice: " + c732());
function c733(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld concat: " + c733());
function c734(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld push: " + c734());
function c735(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld pop: " + c735());
function c736(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld sort: " + c736());
function c737(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing map: " + c737());
function c738(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing join: " + c738());
function c739(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing indexOf: " + c739());
function c740(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing slice: " + c740());
function c741(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing concat: " + c741());
function c742(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing push: " + c742());
function c743(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing pop: " + c743());
function c744(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing sort: " + c744());
function c745(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld map: " + c745());
function c746(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld join: " + c746());
function c747(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld indexOf: " + c747());
function c748(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld slice: " + c748());
function c749(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld concat: " + c749());
function c750(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld push: " + c750());
function c751(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld pop: " + c751());
function c752(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld sort: " + c752());
function c753(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing map: " + c753());
function c754(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing join: " + c754());
function c755(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing indexOf: " + c755());
function c756(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing slice: " + c756());
function c757(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing concat: " + c757());
function c758(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing push: " + c758());
function c759(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing pop: " + c759());
function c760(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing sort: " + c760());
function c761(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld map: " + c761());
function c762(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld join: " + c762());
function c763(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld indexOf: " + c763());
function c764(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld slice: " + c764());
function c765(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld concat: " + c765());
function c766(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld push: " + c766());
function c767(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld pop: " + c767());
function c768(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld sort: " + c768());
function c769(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing map: " + c769());
function c770(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing join: " + c770());
function c771(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing indexOf: " + c771());
function c772(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing slice: " + c772());
function c773(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing concat: " + c773());
function c774(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing push: " + c774());
function c775(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing pop: " + c775());
function c776(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing sort: " + c776());
function c777(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld map: " + c777());
function c778(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld join: " + c778());
function c779(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld indexOf: " + c779());
function c780(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld slice: " + c780());
function c781(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld concat: " + c781());
function c782(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld push: " + c782());
function c783(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld pop: " + c783());
function c784(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld sort: " + c784());
function c785(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing map: " + c785());
function c786(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing join: " + c786());
function c787(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing indexOf: " + c787());
function c788(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing slice: " + c788());
function c789(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing concat: " + c789());
function c790(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing push: " + c790());
function c791(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing pop: " + c791());
function c792(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing sort: " + c792());
function c793(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld map: " + c793());
function c794(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld join: " + c794());
function c795(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld indexOf: " + c795());
function c796(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld slice: " + c796());
function c797(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld concat: " + c797());
function c798(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld push: " + c798());
function c799(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld pop: " + c799());
function c800(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld sort: " + c800());
function c801(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing map: " + c801());
function c802(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing join: " + c802());
function c803(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing indexOf: " + c803());
function c804(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing slice: " + c804());
function c805(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing concat: " + c805());
function c806(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing push: " + c806());
function c807(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing pop: " + c807());
function c808(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing sort: " + c808());
function c809(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld map: " + c809());
function c810(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld join: " + c810());
function c811(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld indexOf: " + c811());
function c812(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld slice: " + c812());
function c813(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld concat: " + c813());
function c814(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld push: " + c814());
function c815(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld pop: " + c815());
function c816(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld sort: " + c816());
function c817(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing map: " + c817());
function c818(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing join: " + c818());
function c819(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing indexOf: " + c819());
function c820(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing slice: " + c820());
function c821(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing concat: " + c821());
function c822(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing push: " + c822());
function c823(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing pop: " + c823());
function c824(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing sort: " + c824());
function c825(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld map: " + c825());
function c826(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld join: " + c826());
function c827(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld indexOf: " + c827());
function c828(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld slice: " + c828());
function c829(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld concat: " + c829());
function c830(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld push: " + c830());
function c831(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld pop: " + c831());
function c832(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld sort: " + c832());
function c833(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing map: " + c833());
function c834(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing join: " + c834());
function c835(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing indexOf: " + c835());
function c836(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing slice: " + c836());
function c837(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing concat: " + c837());
function c838(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing push: " + c838());
function c839(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing pop: " + c839());
function c840(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing sort: " + c840());
function c841(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld map: " + c841());
function c842(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld join: " + c842());
function c843(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld indexOf: " + c843());
function c844(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld slice: " + c844());
function c845(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld concat: " + c845());
function c846(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld push: " + c846());
function c847(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld pop: " + c847());
function c848(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld sort: " + c848());
function c849(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing map: " + c849());
function c850(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing join: " + c850());
function c851(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing indexOf: " + c851());
function c852(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing slice: " + c852());
function c853(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing concat: " + c853());
function c854(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing push: " + c854());
function c855(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing pop: " + c855());
function c856(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing sort: " + c856());
function c857(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld map: " + c857());
function c858(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld join: " + c858());
function c859(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld indexOf: " + c859());
function c860(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld slice: " + c860());
function c861(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld concat: " + c861());
function c862(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld push: " + c862());
function c863(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld pop: " + c863());
function c864(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld sort: " + c864());
function c865(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing map: " + c865());
function c866(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing join: " + c866());
function c867(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing indexOf: " + c867());
function c868(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing slice: " + c868());
function c869(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing concat: " + c869());
function c870(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing push: " + c870());
function c871(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing pop: " + c871());
function c872(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing sort: " + c872());
function c873(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld map: " + c873());
function c874(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld join: " + c874());
function c875(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld indexOf: " + c875());
function c876(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld slice: " + c876());
function c877(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld concat: " + c877());
function c878(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld push: " + c878());
function c879(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld pop: " + c879());
function c880(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld sort: " + c880());
function c881(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing map: " + c881());
function c882(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing join: " + c882());
function c883(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing indexOf: " + c883());
function c884(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing slice: " + c884());
function c885(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing concat: " + c885());
function c886(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing push: " + c886());
function c887(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing pop: " + c887());
function c888(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing sort: " + c888());
function c889(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("map");
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld map: " + c889());
function c890(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("join");
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld join: " + c890());
function c891(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("indexOf");
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld indexOf: " + c891());
function c892(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("slice");
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld slice: " + c892());
function c893(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("concat");
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld concat: " + c893());
function c894(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("push");
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld push: " + c894());
function c895(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("pop");
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld pop: " + c895());
function c896(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("sort");
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld sort: " + c896());
function c897(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing map: " + c897());
function c898(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.join("-"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing join: " + c898());
function c899(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing indexOf: " + c899());
function c900(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.slice(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing slice: " + c900());
function c901(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.concat([9]); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing concat: " + c901());
function c902(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.push(7); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing push: " + c902());
function c903(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.pop(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing pop: " + c903());
function c904(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.sort(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing sort: " + c904());
function c905(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).map = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod map: " + c905());
function c906(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).join = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod join: " + c906());
function c907(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).indexOf = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod indexOf: " + c907());
function c908(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).slice = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod slice: " + c908());
function c909(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).concat = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod concat: " + c909());
function c910(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).push = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod push: " + c910());
function c911(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).pop = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod pop: " + c911());
function c912(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).sort = () => "its own"; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ownMethod sort: " + c912());
function c913(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "map"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere map: " + c913());
function c914(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "join"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere join: " + c914());
function c915(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "indexOf"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere indexOf: " + c915());
function c916(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "slice"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere slice: " + c916());
function c917(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "concat"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere concat: " + c917());
function c918(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "push"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere push: " + c918());
function c919(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "pop"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere pop: " + c919());
function c920(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { meddlers[yes ? 0 : 2](a, "sort"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal elsewhere sort: " + c920());
function c921(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("map")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype map: " + c921());
function c922(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("join")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype join: " + c922());
function c923(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("indexOf")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype indexOf: " + c923());
function c924(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("slice")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype slice: " + c924());
function c925(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("concat")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype concat: " + c925());
function c926(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("push")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype push: " + c926());
function c927(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("pop")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype pop: " + c927());
function c928(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.setPrototypeOf(a, otherPrototype("sort")); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal prototype sort: " + c928());
function c929(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen map: " + c929());
function c930(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen join: " + c930());
function c931(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen indexOf: " + c931());
function c932(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen slice: " + c932());
function c933(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen concat: " + c933());
function c934(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen push: " + c934());
function c935(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen pop: " + c935());
function c936(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { Object.freeze(a); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal frozen sort: " + c936());
function c937(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName map: " + c937());
function c938(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName join: " + c938());
function c939(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName indexOf: " + c939());
function c940(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName slice: " + c940());
function c941(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName concat: " + c941());
function c942(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName push: " + c942());
function c943(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName pop: " + c943());
function c944(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { (a as any).extra = 1; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal harmlessName sort: " + c944());
function c945(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("map"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held map: " + c945());
function c946(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("join"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held join: " + c946());
function c947(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("indexOf"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held indexOf: " + c947());
function c948(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("slice"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held slice: " + c948());
function c949(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("concat"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held concat: " + c949());
function c950(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("push"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held push: " + c950());
function c951(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("pop"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held pop: " + c951());
function c952(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { holder.it = a; alterWhatIsHeld("sort"); }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal held sort: " + c952());
function c953(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).map = () => "its own";
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod map: " + c953());
function c954(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).join = () => "its own";
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod join: " + c954());
function c955(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).indexOf = () => "its own";
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod indexOf: " + c955());
function c956(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).slice = () => "its own";
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod slice: " + c956());
function c957(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).concat = () => "its own";
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod concat: " + c957());
function c958(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).push = () => "its own";
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod push: " + c958());
function c959(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).pop = () => "its own";
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod pop: " + c959());
function c960(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).sort = () => "its own";
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod sort: " + c960());
function c961(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "map");
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere map: " + c961());
function c962(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "join");
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere join: " + c962());
function c963(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "indexOf");
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere indexOf: " + c963());
function c964(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "slice");
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere slice: " + c964());
function c965(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "concat");
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere concat: " + c965());
function c966(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "push");
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere push: " + c966());
function c967(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "pop");
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere pop: " + c967());
function c968(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "sort");
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere sort: " + c968());
function c969(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("map"));
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype map: " + c969());
function c970(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("join"));
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype join: " + c970());
function c971(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("indexOf"));
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype indexOf: " + c971());
function c972(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("slice"));
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype slice: " + c972());
function c973(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("concat"));
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype concat: " + c973());
function c974(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("push"));
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype push: " + c974());
function c975(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("pop"));
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype pop: " + c975());
function c976(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.setPrototypeOf(a, otherPrototype("sort"));
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal prototype sort: " + c976());
function c977(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen map: " + c977());
function c978(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen join: " + c978());
function c979(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen indexOf: " + c979());
function c980(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen slice: " + c980());
function c981(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen concat: " + c981());
function c982(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen push: " + c982());
function c983(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen pop: " + c983());
function c984(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.freeze(a);
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal frozen sort: " + c984());
function c985(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName map: " + c985());
function c986(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName join: " + c986());
function c987(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName indexOf: " + c987());
function c988(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName slice: " + c988());
function c989(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName concat: " + c989());
function c990(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName push: " + c990());
function c991(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName pop: " + c991());
function c992(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName sort: " + c992());
function c993(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("map");
        try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held map: " + c993());
function c994(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("join");
        try { r = a.join("-"); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held join: " + c994());
function c995(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("indexOf");
        try { r = a.indexOf(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held indexOf: " + c995());
function c996(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("slice");
        try { r = a.slice(1); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held slice: " + c996());
function c997(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("concat");
        try { r = a.concat([9]); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held concat: " + c997());
function c998(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("push");
        try { r = a.push(7); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held push: " + c998());
function c999(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("pop");
        try { r = a.pop(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held pop: " + c999());
function c1000(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("sort");
        try { r = a.sort(); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held sort: " + c1000());

function restOf(...a: any[]): string { let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
function restAltered(...a: any[]): string { (a as any).map = () => "its own"; let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
lines.push("rest: " + restOf(1, 2, 3) + " " + restAltered(1, 2, 3));
async function acrossAwait(): Promise<string> { const a: any = [3, 1, 2]; await null; const first = show(a.map((x: number) => x * 2)); holder.it = a; await null; alterWhatIsHeld("map"); await null; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } return first + " " + show(r); }
function* acrossYield(): Generator<string> { const a: any = [3, 1, 2]; yield show(a.map((x: number) => x * 2)); holder.it = a; yield "held"; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } yield show(r); }
const steps = acrossYield(); lines.push("yield: " + steps.next().value + " " + steps.next().value); alterWhatIsHeld("map"); lines.push("yield: " + steps.next().value);

function c1001(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing has: " + c1001());
function c1002(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing add: " + c1002());
function c1003(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing delete: " + c1003());
function c1004(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing size: " + c1004());
function c1005(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing forEach: " + c1005());
function c1006(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing values: " + c1006());
function c1007(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing clear: " + c1007());
function c1008(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).has = () => "its own";
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod has: " + c1008());
function c1009(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).add = () => "its own";
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod add: " + c1009());
function c1010(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).delete = () => "its own";
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod delete: " + c1010());
function c1011(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).forEach = () => "its own";
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod forEach: " + c1011());
function c1012(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).values = () => "its own";
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod values: " + c1012());
function c1013(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).clear = () => "its own";
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod clear: " + c1013());
function c1014(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { has: function () { return "of another prototype"; } });
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype has: " + c1014());
function c1015(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { add: function () { return "of another prototype"; } });
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype add: " + c1015());
function c1016(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { delete: function () { return "of another prototype"; } });
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype delete: " + c1016());
function c1017(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { size: function () { return "of another prototype"; } });
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype size: " + c1017());
function c1018(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { forEach: function () { return "of another prototype"; } });
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype forEach: " + c1018());
function c1019(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { values: function () { return "of another prototype"; } });
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype values: " + c1019());
function c1020(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { clear: function () { return "of another prototype"; } });
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype clear: " + c1020());
function c1021(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "has");
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere has: " + c1021());
function c1022(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "add");
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere add: " + c1022());
function c1023(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "delete");
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere delete: " + c1023());
function c1024(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "forEach");
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere forEach: " + c1024());
function c1025(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "values");
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere values: " + c1025());
function c1026(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "clear");
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere clear: " + c1026());
function c1027(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("has");
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held has: " + c1027());
function c1028(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("add");
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held add: " + c1028());
function c1029(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("delete");
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held delete: " + c1029());
function c1030(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("forEach");
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held forEach: " + c1030());
function c1031(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("values");
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held values: " + c1031());
function c1032(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("clear");
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held clear: " + c1032());
function c1033(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen has: " + c1033());
function c1034(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen add: " + c1034());
function c1035(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen delete: " + c1035());
function c1036(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen size: " + c1036());
function c1037(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen forEach: " + c1037());
function c1038(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen values: " + c1038());
function c1039(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen clear: " + c1039());
function c1040(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName has: " + c1040());
function c1041(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.add(3).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName add: " + c1041());
function c1042(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName delete: " + c1042());
function c1043(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName size: " + c1043());
function c1044(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName forEach: " + c1044());
function c1045(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = [...s.values()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName values: " + c1045());
function c1046(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName clear: " + c1046());
function c1047(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing has: " + c1047());
function c1048(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing get: " + c1048());
function c1049(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing set: " + c1049());
function c1050(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing delete: " + c1050());
function c1051(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing size: " + c1051());
function c1052(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing forEach: " + c1052());
function c1053(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing keys: " + c1053());
function c1054(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing clear: " + c1054());
function c1055(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).has = () => "its own";
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod has: " + c1055());
function c1056(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).get = () => "its own";
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod get: " + c1056());
function c1057(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).set = () => "its own";
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod set: " + c1057());
function c1058(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).delete = () => "its own";
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod delete: " + c1058());
function c1059(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).forEach = () => "its own";
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod forEach: " + c1059());
function c1060(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).keys = () => "its own";
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod keys: " + c1060());
function c1061(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).clear = () => "its own";
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod clear: " + c1061());
function c1062(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { has: function () { return "of another prototype"; } });
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype has: " + c1062());
function c1063(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { get: function () { return "of another prototype"; } });
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype get: " + c1063());
function c1064(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { set: function () { return "of another prototype"; } });
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype set: " + c1064());
function c1065(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { delete: function () { return "of another prototype"; } });
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype delete: " + c1065());
function c1066(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { size: function () { return "of another prototype"; } });
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype size: " + c1066());
function c1067(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { forEach: function () { return "of another prototype"; } });
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype forEach: " + c1067());
function c1068(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { keys: function () { return "of another prototype"; } });
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype keys: " + c1068());
function c1069(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { clear: function () { return "of another prototype"; } });
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype clear: " + c1069());
function c1070(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "has");
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere has: " + c1070());
function c1071(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "get");
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere get: " + c1071());
function c1072(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "set");
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere set: " + c1072());
function c1073(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "delete");
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere delete: " + c1073());
function c1074(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "forEach");
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere forEach: " + c1074());
function c1075(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "keys");
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere keys: " + c1075());
function c1076(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "clear");
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere clear: " + c1076());
function c1077(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("has");
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held has: " + c1077());
function c1078(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("get");
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held get: " + c1078());
function c1079(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("set");
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held set: " + c1079());
function c1080(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("delete");
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held delete: " + c1080());
function c1081(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("forEach");
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held forEach: " + c1081());
function c1082(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("keys");
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held keys: " + c1082());
function c1083(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("clear");
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held clear: " + c1083());
function c1084(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen has: " + c1084());
function c1085(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen get: " + c1085());
function c1086(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen set: " + c1086());
function c1087(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen delete: " + c1087());
function c1088(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen size: " + c1088());
function c1089(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen forEach: " + c1089());
function c1090(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen keys: " + c1090());
function c1091(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen clear: " + c1091());
function c1092(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.has(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName has: " + c1092());
function c1093(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.get(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName get: " + c1093());
function c1094(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.set(3, 4).size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName set: " + c1094());
function c1095(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.delete(1); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName delete: " + c1095());
function c1096(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.size; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName size: " + c1096());
function c1097(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.forEach((x: number) => { sum += x; }); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName forEach: " + c1097());
function c1098(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = [...s.keys()]; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName keys: " + c1098());
function c1099(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.clear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName clear: " + c1099());
function c1100(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing has: " + c1100());
function c1101(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing get: " + c1101());
function c1102(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing set: " + c1102());
function c1103(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing delete: " + c1103());
function c1104(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).has = () => "its own";
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod has: " + c1104());
function c1105(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).get = () => "its own";
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod get: " + c1105());
function c1106(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).set = () => "its own";
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod set: " + c1106());
function c1107(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).delete = () => "its own";
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod delete: " + c1107());
function c1108(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { has: function () { return "of another prototype"; } });
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype has: " + c1108());
function c1109(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { get: function () { return "of another prototype"; } });
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype get: " + c1109());
function c1110(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { set: function () { return "of another prototype"; } });
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype set: " + c1110());
function c1111(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { delete: function () { return "of another prototype"; } });
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype delete: " + c1111());
function c1112(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "has");
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere has: " + c1112());
function c1113(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "get");
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere get: " + c1113());
function c1114(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "set");
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere set: " + c1114());
function c1115(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "delete");
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere delete: " + c1115());
function c1116(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("has");
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held has: " + c1116());
function c1117(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("get");
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held get: " + c1117());
function c1118(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("set");
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held set: " + c1118());
function c1119(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("delete");
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held delete: " + c1119());
function c1120(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen has: " + c1120());
function c1121(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen get: " + c1121());
function c1122(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen set: " + c1122());
function c1123(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen delete: " + c1123());
function c1124(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.has(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName has: " + c1124());
function c1125(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.get(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName get: " + c1125());
function c1126(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.set(given, 4) === s; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName set: " + c1126());
function c1127(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.delete(holder); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName delete: " + c1127());
function c1128(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing getTime: " + c1128());
function c1129(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing getUTCFullYear: " + c1129());
function c1130(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing toISOString: " + c1130());
function c1131(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing valueOf: " + c1131());
function c1132(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).getTime = () => "its own";
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod getTime: " + c1132());
function c1133(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).getUTCFullYear = () => "its own";
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod getUTCFullYear: " + c1133());
function c1134(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).toISOString = () => "its own";
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod toISOString: " + c1134());
function c1135(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).valueOf = () => "its own";
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod valueOf: " + c1135());
function c1136(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { getTime: function () { return "of another prototype"; } });
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype getTime: " + c1136());
function c1137(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { getUTCFullYear: function () { return "of another prototype"; } });
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype getUTCFullYear: " + c1137());
function c1138(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { toISOString: function () { return "of another prototype"; } });
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype toISOString: " + c1138());
function c1139(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { valueOf: function () { return "of another prototype"; } });
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype valueOf: " + c1139());
function c1140(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "getTime");
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date elsewhere getTime: " + c1140());
function c1141(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "getUTCFullYear");
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date elsewhere getUTCFullYear: " + c1141());
function c1142(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "toISOString");
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date elsewhere toISOString: " + c1142());
function c1143(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "valueOf");
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date elsewhere valueOf: " + c1143());
function c1144(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("getTime");
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date held getTime: " + c1144());
function c1145(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("getUTCFullYear");
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date held getUTCFullYear: " + c1145());
function c1146(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("toISOString");
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date held toISOString: " + c1146());
function c1147(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("valueOf");
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date held valueOf: " + c1147());
function c1148(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen getTime: " + c1148());
function c1149(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen getUTCFullYear: " + c1149());
function c1150(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen toISOString: " + c1150());
function c1151(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen valueOf: " + c1151());
function c1152(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName getTime: " + c1152());
function c1153(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName getUTCFullYear: " + c1153());
function c1154(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName toISOString: " + c1154());
function c1155(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName valueOf: " + c1155());
function c1156(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing test: " + c1156());
function c1157(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing exec: " + c1157());
function c1158(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing toString: " + c1158());
function c1159(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).test = () => "its own";
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod test: " + c1159());
function c1160(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).exec = () => "its own";
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod exec: " + c1160());
function c1161(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).toString = () => "its own";
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod toString: " + c1161());
function c1162(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { test: function () { return "of another prototype"; } });
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype test: " + c1162());
function c1163(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { exec: function () { return "of another prototype"; } });
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype exec: " + c1163());
function c1164(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { toString: function () { return "of another prototype"; } });
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype toString: " + c1164());
function c1165(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "test");
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp elsewhere test: " + c1165());
function c1166(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "exec");
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp elsewhere exec: " + c1166());
function c1167(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "toString");
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp elsewhere toString: " + c1167());
function c1168(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("test");
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp held test: " + c1168());
function c1169(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("exec");
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp held exec: " + c1169());
function c1170(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("toString");
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp held toString: " + c1170());
function c1171(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen test: " + c1171());
function c1172(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen exec: " + c1172());
function c1173(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen toString: " + c1173());
function c1174(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName test: " + c1174());
function c1175(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName exec: " + c1175());
function c1176(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName toString: " + c1176());
acrossAwait().then(text => { lines.push("await: " + text); console.log(lines.join("\n")); });
