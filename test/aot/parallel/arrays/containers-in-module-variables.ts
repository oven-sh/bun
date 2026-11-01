
function show(v: unknown): string {
    if (Array.isArray(v)) return "[" + Array.prototype.map.call(v, show).join(",") + "]";
    if (v instanceof Map) return "Map(" + Map.prototype.entries.call(v).toArray().map(show).join(",") + ")";
    if (v instanceof Set) return "Set(" + Set.prototype.values.call(v).toArray().map(show).join(",") + ")";
    if (typeof v === "function") return "function";
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const yes: boolean = Date.now() > 0;
const no: boolean = Date.now() < 0;
const holder: { it: any } = { it: undefined };
let elsewhere: any = undefined;
let marks = 0;
function alter(given: any): void {
    const x: any = given;
    if (Array.isArray(given)) {
        x.map = () => [-1];
        x.filter = () => [-2];
        x.includes = () => true;
        x.join = () => "own join";
        x.indexOf = () => -7;
        x.some = () => true;
        x.every = () => false;
        x.slice = () => [-3];
        x.at = () => -4;
        x.find = () => -5;
        x.findIndex = () => -9;
        x.reduce = () => -10;
        x.flatMap = () => [-11];
        x.forEach = () => { marks += 100; };
        x.push = () => -12;
        x.keys = () => [-8][Symbol.iterator]();
        return;
    }
    if (given instanceof Map) {
        (x as any).get = () => -1;
        (x as any).has = () => true;
        (x as any).set = () => x;
        (x as any).delete = () => true;
        (x as any).forEach = () => { marks += 100; };
        (x as any).keys = () => ["own key"][Symbol.iterator]();
        (x as any).values = () => [-2][Symbol.iterator]();
        (x as any).entries = () => [["own entry", -3]][Symbol.iterator]();
        (x as any)[Symbol.iterator] = function* () { yield ["own", -4]; };
        Object.defineProperty(x, "size", { value: -5, configurable: true });
        return;
    }
    if (given instanceof Set) {
        (x as any).has = () => true;
        (x as any).add = () => x;
        (x as any).delete = () => true;
        (x as any).forEach = () => { marks += 100; };
        (x as any).keys = () => ["own key"][Symbol.iterator]();
        (x as any).values = () => ["own value"][Symbol.iterator]();
        (x as any)[Symbol.iterator] = function* () { yield "own"; };
        Object.defineProperty(x, "size", { value: -5, configurable: true });
    }
}
function alterThis(this: any): void { alter(this); }
function alterFirst(...all: any[]): void { alter(all[0]); }
function identity<T>(x: T): T { return x; }
function otherPrototypeOf(x: any): any {
    const p: any = Object.create(Object.getPrototypeOf(x));
    if (Array.isArray(x)) { p.map = () => [-21]; p.includes = () => true; p.join = () => "join of another prototype"; p.some = () => true; p.filter = () => [-22]; }
    else { p.has = () => true; p.get = () => -21; p.forEach = () => { marks += 1000; }; }
    return p;
}
class ArrayHeir extends Array<number> { map(): any { return [-31]; } includes(): boolean { return true; } join(): string { return "join of an heir"; } }
class MapHeir extends Map<string, number> { get(): number { return -31; } has(): boolean { return true; } get size(): number { return -32; } }
class SetHeir extends Set<string> { has(): boolean { return true; } get size(): number { return -32; } }
const lines: string[] = [];
function report(name: string, plain: () => string, guarded: () => string, meddle: () => void): void {
    const take = (f: () => string): string => { try { return f(); } catch (e) { return thrown(e); } };
    lines.push(name + " before: " + take(plain) + " || " + take(guarded));
    let how = "";
    try { meddle(); } catch (e) { how = " (" + thrown(e) + ")"; }
    lines.push(name + " behind" + how + ": " + take(plain) + " || " + take(guarded) + " marks " + marks);
    marks = 0;
}
function double(x: number): number { return x * 2; }
function isLarge(x: number): boolean { return x > 1; }
const array_nothing: number[] = [3, 1, 2];
function sumOf_array_nothing(): number { let t = 0; for (const x of array_nothing) t += x; return t; }
function eachOf_array_nothing(): number { let t = 0; array_nothing.forEach((x: number) => { t += x; }); return t; }
function plain_array_nothing(): string {
    const seen: string[] = [];
    seen.push(show(array_nothing.map((x: number) => x * 2)));
    seen.push(show(array_nothing.includes(99)));
    seen.push(show(array_nothing.join("-")));
    seen.push(show(array_nothing.some((x: number) => x > 50)));
    seen.push(show(array_nothing.length));
    seen.push(show([...array_nothing]));
    seen.push(show(sumOf_array_nothing()));
    seen.push(show(eachOf_array_nothing()));
    seen.push(show(array_nothing.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_nothing(): void {  }
const map_nothing: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_nothing(): number { let t = 0; for (const [k, v] of map_nothing) t += v + k.length; return t; }
function eachOf_map_nothing(): number { let t = 0; map_nothing.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_nothing(): string {
    const seen: string[] = [];
    seen.push(show(map_nothing.get("a")));
    seen.push(show(map_nothing.has("zz")));
    seen.push(show(map_nothing.size));
    seen.push(show([...map_nothing.keys()]));
    seen.push(show(sumOf_map_nothing()));
    seen.push(show(eachOf_map_nothing()));
    return seen.join(" ");
}
function meddle_map_nothing(): void {  }
const set_nothing: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_nothing(): number { let t = 0; for (const k of set_nothing) t += k.length; return t; }
function eachOf_set_nothing(): number { let t = 0; set_nothing.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_nothing(): string {
    const seen: string[] = [];
    seen.push(show(set_nothing.has("zz")));
    seen.push(show(set_nothing.size));
    seen.push(show([...set_nothing]));
    seen.push(show(sumOf_set_nothing()));
    seen.push(show(eachOf_set_nothing()));
    return seen.join(" ");
}
function meddle_set_nothing(): void {  }
const array_onlyRead: number[] = [3, 1, 2];
function sumOf_array_onlyRead(): number { let t = 0; for (const x of array_onlyRead) t += x; return t; }
function eachOf_array_onlyRead(): number { let t = 0; array_onlyRead.forEach((x: number) => { t += x; }); return t; }
function plain_array_onlyRead(): string {
    const seen: string[] = [];
    seen.push(show(array_onlyRead.map((x: number) => x * 2)));
    seen.push(show(array_onlyRead.includes(99)));
    seen.push(show(array_onlyRead.join("-")));
    seen.push(show(array_onlyRead.some((x: number) => x > 50)));
    seen.push(show(array_onlyRead.length));
    seen.push(show([...array_onlyRead]));
    seen.push(show(sumOf_array_onlyRead()));
    seen.push(show(eachOf_array_onlyRead()));
    seen.push(show(array_onlyRead.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_onlyRead(): void { marks += array_onlyRead === undefined ? 1 : 0; marks += typeof array_onlyRead === "object" ? 0 : 1; }
const map_onlyRead: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_onlyRead(): number { let t = 0; for (const [k, v] of map_onlyRead) t += v + k.length; return t; }
function eachOf_map_onlyRead(): number { let t = 0; map_onlyRead.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_onlyRead(): string {
    const seen: string[] = [];
    seen.push(show(map_onlyRead.get("a")));
    seen.push(show(map_onlyRead.has("zz")));
    seen.push(show(map_onlyRead.size));
    seen.push(show([...map_onlyRead.keys()]));
    seen.push(show(sumOf_map_onlyRead()));
    seen.push(show(eachOf_map_onlyRead()));
    return seen.join(" ");
}
function meddle_map_onlyRead(): void { marks += map_onlyRead === undefined ? 1 : 0; marks += typeof map_onlyRead === "object" ? 0 : 1; }
const set_onlyRead: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_onlyRead(): number { let t = 0; for (const k of set_onlyRead) t += k.length; return t; }
function eachOf_set_onlyRead(): number { let t = 0; set_onlyRead.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_onlyRead(): string {
    const seen: string[] = [];
    seen.push(show(set_onlyRead.has("zz")));
    seen.push(show(set_onlyRead.size));
    seen.push(show([...set_onlyRead]));
    seen.push(show(sumOf_set_onlyRead()));
    seen.push(show(eachOf_set_onlyRead()));
    return seen.join(" ");
}
function meddle_set_onlyRead(): void { marks += set_onlyRead === undefined ? 1 : 0; marks += typeof set_onlyRead === "object" ? 0 : 1; }
const array_ownMethod: number[] = [3, 1, 2];
function sumOf_array_ownMethod(): number { let t = 0; for (const x of array_ownMethod) t += x; return t; }
function eachOf_array_ownMethod(): number { let t = 0; array_ownMethod.forEach((x: number) => { t += x; }); return t; }
function plain_array_ownMethod(): string {
    const seen: string[] = [];
    seen.push(show(array_ownMethod.map((x: number) => x * 2)));
    seen.push(show(array_ownMethod.includes(99)));
    seen.push(show(array_ownMethod.join("-")));
    seen.push(show(array_ownMethod.some((x: number) => x > 50)));
    seen.push(show(array_ownMethod.length));
    seen.push(show([...array_ownMethod]));
    seen.push(show(sumOf_array_ownMethod()));
    seen.push(show(eachOf_array_ownMethod()));
    seen.push(show(array_ownMethod.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_ownMethod(): void { (array_ownMethod as any).map = () => [-41]; }
const map_ownMethod: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_ownMethod(): number { let t = 0; for (const [k, v] of map_ownMethod) t += v + k.length; return t; }
function eachOf_map_ownMethod(): number { let t = 0; map_ownMethod.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_ownMethod(): string {
    const seen: string[] = [];
    seen.push(show(map_ownMethod.get("a")));
    seen.push(show(map_ownMethod.has("zz")));
    seen.push(show(map_ownMethod.size));
    seen.push(show([...map_ownMethod.keys()]));
    seen.push(show(sumOf_map_ownMethod()));
    seen.push(show(eachOf_map_ownMethod()));
    return seen.join(" ");
}
function meddle_map_ownMethod(): void { (map_ownMethod as any).get = () => -41; }
const set_ownMethod: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_ownMethod(): number { let t = 0; for (const k of set_ownMethod) t += k.length; return t; }
function eachOf_set_ownMethod(): number { let t = 0; set_ownMethod.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_ownMethod(): string {
    const seen: string[] = [];
    seen.push(show(set_ownMethod.has("zz")));
    seen.push(show(set_ownMethod.size));
    seen.push(show([...set_ownMethod]));
    seen.push(show(sumOf_set_ownMethod()));
    seen.push(show(eachOf_set_ownMethod()));
    return seen.join(" ");
}
function meddle_set_ownMethod(): void { (set_ownMethod as any).has = () => true; }
const array_ownMethodByKey: number[] = [3, 1, 2];
function sumOf_array_ownMethodByKey(): number { let t = 0; for (const x of array_ownMethodByKey) t += x; return t; }
function eachOf_array_ownMethodByKey(): number { let t = 0; array_ownMethodByKey.forEach((x: number) => { t += x; }); return t; }
function plain_array_ownMethodByKey(): string {
    const seen: string[] = [];
    seen.push(show(array_ownMethodByKey.map((x: number) => x * 2)));
    seen.push(show(array_ownMethodByKey.includes(99)));
    seen.push(show(array_ownMethodByKey.join("-")));
    seen.push(show(array_ownMethodByKey.some((x: number) => x > 50)));
    seen.push(show(array_ownMethodByKey.length));
    seen.push(show([...array_ownMethodByKey]));
    seen.push(show(sumOf_array_ownMethodByKey()));
    seen.push(show(eachOf_array_ownMethodByKey()));
    seen.push(show(array_ownMethodByKey.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_ownMethodByKey(): void { const k: string = yes ? "map" : "x"; (array_ownMethodByKey as any)[k] = () => [-41]; }
const map_ownMethodByKey: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_ownMethodByKey(): number { let t = 0; for (const [k, v] of map_ownMethodByKey) t += v + k.length; return t; }
function eachOf_map_ownMethodByKey(): number { let t = 0; map_ownMethodByKey.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_ownMethodByKey(): string {
    const seen: string[] = [];
    seen.push(show(map_ownMethodByKey.get("a")));
    seen.push(show(map_ownMethodByKey.has("zz")));
    seen.push(show(map_ownMethodByKey.size));
    seen.push(show([...map_ownMethodByKey.keys()]));
    seen.push(show(sumOf_map_ownMethodByKey()));
    seen.push(show(eachOf_map_ownMethodByKey()));
    return seen.join(" ");
}
function meddle_map_ownMethodByKey(): void { const k: string = yes ? "get" : "x"; (map_ownMethodByKey as any)[k] = () => -41; }
const set_ownMethodByKey: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_ownMethodByKey(): number { let t = 0; for (const k of set_ownMethodByKey) t += k.length; return t; }
function eachOf_set_ownMethodByKey(): number { let t = 0; set_ownMethodByKey.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_ownMethodByKey(): string {
    const seen: string[] = [];
    seen.push(show(set_ownMethodByKey.has("zz")));
    seen.push(show(set_ownMethodByKey.size));
    seen.push(show([...set_ownMethodByKey]));
    seen.push(show(sumOf_set_ownMethodByKey()));
    seen.push(show(eachOf_set_ownMethodByKey()));
    return seen.join(" ");
}
function meddle_set_ownMethodByKey(): void { const k: string = yes ? "has" : "x"; (set_ownMethodByKey as any)[k] = () => true; }
const array_handedToFunction: number[] = [3, 1, 2];
function sumOf_array_handedToFunction(): number { let t = 0; for (const x of array_handedToFunction) t += x; return t; }
function eachOf_array_handedToFunction(): number { let t = 0; array_handedToFunction.forEach((x: number) => { t += x; }); return t; }
function plain_array_handedToFunction(): string {
    const seen: string[] = [];
    seen.push(show(array_handedToFunction.map((x: number) => x * 2)));
    seen.push(show(array_handedToFunction.includes(99)));
    seen.push(show(array_handedToFunction.join("-")));
    seen.push(show(array_handedToFunction.some((x: number) => x > 50)));
    seen.push(show(array_handedToFunction.length));
    seen.push(show([...array_handedToFunction]));
    seen.push(show(sumOf_array_handedToFunction()));
    seen.push(show(eachOf_array_handedToFunction()));
    seen.push(show(array_handedToFunction.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_handedToFunction(): void { alter(array_handedToFunction); }
const map_handedToFunction: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_handedToFunction(): number { let t = 0; for (const [k, v] of map_handedToFunction) t += v + k.length; return t; }
function eachOf_map_handedToFunction(): number { let t = 0; map_handedToFunction.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_handedToFunction(): string {
    const seen: string[] = [];
    seen.push(show(map_handedToFunction.get("a")));
    seen.push(show(map_handedToFunction.has("zz")));
    seen.push(show(map_handedToFunction.size));
    seen.push(show([...map_handedToFunction.keys()]));
    seen.push(show(sumOf_map_handedToFunction()));
    seen.push(show(eachOf_map_handedToFunction()));
    return seen.join(" ");
}
function meddle_map_handedToFunction(): void { alter(map_handedToFunction); }
const set_handedToFunction: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_handedToFunction(): number { let t = 0; for (const k of set_handedToFunction) t += k.length; return t; }
function eachOf_set_handedToFunction(): number { let t = 0; set_handedToFunction.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_handedToFunction(): string {
    const seen: string[] = [];
    seen.push(show(set_handedToFunction.has("zz")));
    seen.push(show(set_handedToFunction.size));
    seen.push(show([...set_handedToFunction]));
    seen.push(show(sumOf_set_handedToFunction()));
    seen.push(show(eachOf_set_handedToFunction()));
    return seen.join(" ");
}
function meddle_set_handedToFunction(): void { alter(set_handedToFunction); }
const array_handedOnOneRoad: number[] = [3, 1, 2];
function sumOf_array_handedOnOneRoad(): number { let t = 0; for (const x of array_handedOnOneRoad) t += x; return t; }
function eachOf_array_handedOnOneRoad(): number { let t = 0; array_handedOnOneRoad.forEach((x: number) => { t += x; }); return t; }
function plain_array_handedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(array_handedOnOneRoad.map((x: number) => x * 2)));
    seen.push(show(array_handedOnOneRoad.includes(99)));
    seen.push(show(array_handedOnOneRoad.join("-")));
    seen.push(show(array_handedOnOneRoad.some((x: number) => x > 50)));
    seen.push(show(array_handedOnOneRoad.length));
    seen.push(show([...array_handedOnOneRoad]));
    seen.push(show(sumOf_array_handedOnOneRoad()));
    seen.push(show(eachOf_array_handedOnOneRoad()));
    seen.push(show(array_handedOnOneRoad.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_handedOnOneRoad(): void { if (yes) alter(array_handedOnOneRoad); }
const map_handedOnOneRoad: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_handedOnOneRoad(): number { let t = 0; for (const [k, v] of map_handedOnOneRoad) t += v + k.length; return t; }
function eachOf_map_handedOnOneRoad(): number { let t = 0; map_handedOnOneRoad.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_handedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(map_handedOnOneRoad.get("a")));
    seen.push(show(map_handedOnOneRoad.has("zz")));
    seen.push(show(map_handedOnOneRoad.size));
    seen.push(show([...map_handedOnOneRoad.keys()]));
    seen.push(show(sumOf_map_handedOnOneRoad()));
    seen.push(show(eachOf_map_handedOnOneRoad()));
    return seen.join(" ");
}
function meddle_map_handedOnOneRoad(): void { if (yes) alter(map_handedOnOneRoad); }
const set_handedOnOneRoad: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_handedOnOneRoad(): number { let t = 0; for (const k of set_handedOnOneRoad) t += k.length; return t; }
function eachOf_set_handedOnOneRoad(): number { let t = 0; set_handedOnOneRoad.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_handedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(set_handedOnOneRoad.has("zz")));
    seen.push(show(set_handedOnOneRoad.size));
    seen.push(show([...set_handedOnOneRoad]));
    seen.push(show(sumOf_set_handedOnOneRoad()));
    seen.push(show(eachOf_set_handedOnOneRoad()));
    return seen.join(" ");
}
function meddle_set_handedOnOneRoad(): void { if (yes) alter(set_handedOnOneRoad); }
const array_handedOnARoadNotTaken: number[] = [3, 1, 2];
function sumOf_array_handedOnARoadNotTaken(): number { let t = 0; for (const x of array_handedOnARoadNotTaken) t += x; return t; }
function eachOf_array_handedOnARoadNotTaken(): number { let t = 0; array_handedOnARoadNotTaken.forEach((x: number) => { t += x; }); return t; }
function plain_array_handedOnARoadNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(array_handedOnARoadNotTaken.map((x: number) => x * 2)));
    seen.push(show(array_handedOnARoadNotTaken.includes(99)));
    seen.push(show(array_handedOnARoadNotTaken.join("-")));
    seen.push(show(array_handedOnARoadNotTaken.some((x: number) => x > 50)));
    seen.push(show(array_handedOnARoadNotTaken.length));
    seen.push(show([...array_handedOnARoadNotTaken]));
    seen.push(show(sumOf_array_handedOnARoadNotTaken()));
    seen.push(show(eachOf_array_handedOnARoadNotTaken()));
    seen.push(show(array_handedOnARoadNotTaken.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_handedOnARoadNotTaken(): void { if (no) alter(array_handedOnARoadNotTaken); }
const map_handedOnARoadNotTaken: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_handedOnARoadNotTaken(): number { let t = 0; for (const [k, v] of map_handedOnARoadNotTaken) t += v + k.length; return t; }
function eachOf_map_handedOnARoadNotTaken(): number { let t = 0; map_handedOnARoadNotTaken.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_handedOnARoadNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(map_handedOnARoadNotTaken.get("a")));
    seen.push(show(map_handedOnARoadNotTaken.has("zz")));
    seen.push(show(map_handedOnARoadNotTaken.size));
    seen.push(show([...map_handedOnARoadNotTaken.keys()]));
    seen.push(show(sumOf_map_handedOnARoadNotTaken()));
    seen.push(show(eachOf_map_handedOnARoadNotTaken()));
    return seen.join(" ");
}
function meddle_map_handedOnARoadNotTaken(): void { if (no) alter(map_handedOnARoadNotTaken); }
const set_handedOnARoadNotTaken: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_handedOnARoadNotTaken(): number { let t = 0; for (const k of set_handedOnARoadNotTaken) t += k.length; return t; }
function eachOf_set_handedOnARoadNotTaken(): number { let t = 0; set_handedOnARoadNotTaken.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_handedOnARoadNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(set_handedOnARoadNotTaken.has("zz")));
    seen.push(show(set_handedOnARoadNotTaken.size));
    seen.push(show([...set_handedOnARoadNotTaken]));
    seen.push(show(sumOf_set_handedOnARoadNotTaken()));
    seen.push(show(eachOf_set_handedOnARoadNotTaken()));
    return seen.join(" ");
}
function meddle_set_handedOnARoadNotTaken(): void { if (no) alter(set_handedOnARoadNotTaken); }
const array_throughIdentity: number[] = [3, 1, 2];
function sumOf_array_throughIdentity(): number { let t = 0; for (const x of array_throughIdentity) t += x; return t; }
function eachOf_array_throughIdentity(): number { let t = 0; array_throughIdentity.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughIdentity(): string {
    const seen: string[] = [];
    seen.push(show(array_throughIdentity.map((x: number) => x * 2)));
    seen.push(show(array_throughIdentity.includes(99)));
    seen.push(show(array_throughIdentity.join("-")));
    seen.push(show(array_throughIdentity.some((x: number) => x > 50)));
    seen.push(show(array_throughIdentity.length));
    seen.push(show([...array_throughIdentity]));
    seen.push(show(sumOf_array_throughIdentity()));
    seen.push(show(eachOf_array_throughIdentity()));
    seen.push(show(array_throughIdentity.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughIdentity(): void { alter(identity(array_throughIdentity)); }
const map_throughIdentity: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughIdentity(): number { let t = 0; for (const [k, v] of map_throughIdentity) t += v + k.length; return t; }
function eachOf_map_throughIdentity(): number { let t = 0; map_throughIdentity.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughIdentity(): string {
    const seen: string[] = [];
    seen.push(show(map_throughIdentity.get("a")));
    seen.push(show(map_throughIdentity.has("zz")));
    seen.push(show(map_throughIdentity.size));
    seen.push(show([...map_throughIdentity.keys()]));
    seen.push(show(sumOf_map_throughIdentity()));
    seen.push(show(eachOf_map_throughIdentity()));
    return seen.join(" ");
}
function meddle_map_throughIdentity(): void { alter(identity(map_throughIdentity)); }
const set_throughIdentity: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughIdentity(): number { let t = 0; for (const k of set_throughIdentity) t += k.length; return t; }
function eachOf_set_throughIdentity(): number { let t = 0; set_throughIdentity.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughIdentity(): string {
    const seen: string[] = [];
    seen.push(show(set_throughIdentity.has("zz")));
    seen.push(show(set_throughIdentity.size));
    seen.push(show([...set_throughIdentity]));
    seen.push(show(sumOf_set_throughIdentity()));
    seen.push(show(eachOf_set_throughIdentity()));
    return seen.join(" ");
}
function meddle_set_throughIdentity(): void { alter(identity(set_throughIdentity)); }
const array_throughAField: number[] = [3, 1, 2];
function sumOf_array_throughAField(): number { let t = 0; for (const x of array_throughAField) t += x; return t; }
function eachOf_array_throughAField(): number { let t = 0; array_throughAField.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAField(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAField.map((x: number) => x * 2)));
    seen.push(show(array_throughAField.includes(99)));
    seen.push(show(array_throughAField.join("-")));
    seen.push(show(array_throughAField.some((x: number) => x > 50)));
    seen.push(show(array_throughAField.length));
    seen.push(show([...array_throughAField]));
    seen.push(show(sumOf_array_throughAField()));
    seen.push(show(eachOf_array_throughAField()));
    seen.push(show(array_throughAField.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAField(): void { holder.it = array_throughAField; alter(holder.it); }
const map_throughAField: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAField(): number { let t = 0; for (const [k, v] of map_throughAField) t += v + k.length; return t; }
function eachOf_map_throughAField(): number { let t = 0; map_throughAField.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAField(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAField.get("a")));
    seen.push(show(map_throughAField.has("zz")));
    seen.push(show(map_throughAField.size));
    seen.push(show([...map_throughAField.keys()]));
    seen.push(show(sumOf_map_throughAField()));
    seen.push(show(eachOf_map_throughAField()));
    return seen.join(" ");
}
function meddle_map_throughAField(): void { holder.it = map_throughAField; alter(holder.it); }
const set_throughAField: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAField(): number { let t = 0; for (const k of set_throughAField) t += k.length; return t; }
function eachOf_set_throughAField(): number { let t = 0; set_throughAField.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAField(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAField.has("zz")));
    seen.push(show(set_throughAField.size));
    seen.push(show([...set_throughAField]));
    seen.push(show(sumOf_set_throughAField()));
    seen.push(show(eachOf_set_throughAField()));
    return seen.join(" ");
}
function meddle_set_throughAField(): void { holder.it = set_throughAField; alter(holder.it); }
const array_throughAnotherVariable: number[] = [3, 1, 2];
function sumOf_array_throughAnotherVariable(): number { let t = 0; for (const x of array_throughAnotherVariable) t += x; return t; }
function eachOf_array_throughAnotherVariable(): number { let t = 0; array_throughAnotherVariable.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAnotherVariable(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAnotherVariable.map((x: number) => x * 2)));
    seen.push(show(array_throughAnotherVariable.includes(99)));
    seen.push(show(array_throughAnotherVariable.join("-")));
    seen.push(show(array_throughAnotherVariable.some((x: number) => x > 50)));
    seen.push(show(array_throughAnotherVariable.length));
    seen.push(show([...array_throughAnotherVariable]));
    seen.push(show(sumOf_array_throughAnotherVariable()));
    seen.push(show(eachOf_array_throughAnotherVariable()));
    seen.push(show(array_throughAnotherVariable.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAnotherVariable(): void { elsewhere = array_throughAnotherVariable; alter(elsewhere); }
const map_throughAnotherVariable: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAnotherVariable(): number { let t = 0; for (const [k, v] of map_throughAnotherVariable) t += v + k.length; return t; }
function eachOf_map_throughAnotherVariable(): number { let t = 0; map_throughAnotherVariable.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAnotherVariable(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAnotherVariable.get("a")));
    seen.push(show(map_throughAnotherVariable.has("zz")));
    seen.push(show(map_throughAnotherVariable.size));
    seen.push(show([...map_throughAnotherVariable.keys()]));
    seen.push(show(sumOf_map_throughAnotherVariable()));
    seen.push(show(eachOf_map_throughAnotherVariable()));
    return seen.join(" ");
}
function meddle_map_throughAnotherVariable(): void { elsewhere = map_throughAnotherVariable; alter(elsewhere); }
const set_throughAnotherVariable: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAnotherVariable(): number { let t = 0; for (const k of set_throughAnotherVariable) t += k.length; return t; }
function eachOf_set_throughAnotherVariable(): number { let t = 0; set_throughAnotherVariable.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAnotherVariable(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAnotherVariable.has("zz")));
    seen.push(show(set_throughAnotherVariable.size));
    seen.push(show([...set_throughAnotherVariable]));
    seen.push(show(sumOf_set_throughAnotherVariable()));
    seen.push(show(eachOf_set_throughAnotherVariable()));
    return seen.join(" ");
}
function meddle_set_throughAnotherVariable(): void { elsewhere = set_throughAnotherVariable; alter(elsewhere); }
const array_throughAGetter: number[] = [3, 1, 2];
function sumOf_array_throughAGetter(): number { let t = 0; for (const x of array_throughAGetter) t += x; return t; }
function eachOf_array_throughAGetter(): number { let t = 0; array_throughAGetter.forEach((x: number) => { t += x; }); return t; }
function get_array_throughAGetter(): number[] { return array_throughAGetter; }
function plain_array_throughAGetter(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAGetter.map((x: number) => x * 2)));
    seen.push(show(array_throughAGetter.includes(99)));
    seen.push(show(array_throughAGetter.join("-")));
    seen.push(show(array_throughAGetter.some((x: number) => x > 50)));
    seen.push(show(array_throughAGetter.length));
    seen.push(show([...array_throughAGetter]));
    seen.push(show(sumOf_array_throughAGetter()));
    seen.push(show(eachOf_array_throughAGetter()));
    seen.push(show(array_throughAGetter.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAGetter(): void { alter(get_array_throughAGetter()); }
const map_throughAGetter: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAGetter(): number { let t = 0; for (const [k, v] of map_throughAGetter) t += v + k.length; return t; }
function eachOf_map_throughAGetter(): number { let t = 0; map_throughAGetter.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function get_map_throughAGetter(): Map<string, number> { return map_throughAGetter; }
function plain_map_throughAGetter(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAGetter.get("a")));
    seen.push(show(map_throughAGetter.has("zz")));
    seen.push(show(map_throughAGetter.size));
    seen.push(show([...map_throughAGetter.keys()]));
    seen.push(show(sumOf_map_throughAGetter()));
    seen.push(show(eachOf_map_throughAGetter()));
    return seen.join(" ");
}
function meddle_map_throughAGetter(): void { alter(get_map_throughAGetter()); }
const set_throughAGetter: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAGetter(): number { let t = 0; for (const k of set_throughAGetter) t += k.length; return t; }
function eachOf_set_throughAGetter(): number { let t = 0; set_throughAGetter.forEach((k: string) => { t += k.length; }); return t; }
function get_set_throughAGetter(): Set<string> { return set_throughAGetter; }
function plain_set_throughAGetter(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAGetter.has("zz")));
    seen.push(show(set_throughAGetter.size));
    seen.push(show([...set_throughAGetter]));
    seen.push(show(sumOf_set_throughAGetter()));
    seen.push(show(eachOf_set_throughAGetter()));
    return seen.join(" ");
}
function meddle_set_throughAGetter(): void { alter(get_set_throughAGetter()); }
const array_throughAnArrow: number[] = [3, 1, 2];
function sumOf_array_throughAnArrow(): number { let t = 0; for (const x of array_throughAnArrow) t += x; return t; }
function eachOf_array_throughAnArrow(): number { let t = 0; array_throughAnArrow.forEach((x: number) => { t += x; }); return t; }
const arrow_array_throughAnArrow = (): number[] => array_throughAnArrow;
function plain_array_throughAnArrow(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAnArrow.map((x: number) => x * 2)));
    seen.push(show(array_throughAnArrow.includes(99)));
    seen.push(show(array_throughAnArrow.join("-")));
    seen.push(show(array_throughAnArrow.some((x: number) => x > 50)));
    seen.push(show(array_throughAnArrow.length));
    seen.push(show([...array_throughAnArrow]));
    seen.push(show(sumOf_array_throughAnArrow()));
    seen.push(show(eachOf_array_throughAnArrow()));
    seen.push(show(array_throughAnArrow.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAnArrow(): void { alter(arrow_array_throughAnArrow()); }
const map_throughAnArrow: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAnArrow(): number { let t = 0; for (const [k, v] of map_throughAnArrow) t += v + k.length; return t; }
function eachOf_map_throughAnArrow(): number { let t = 0; map_throughAnArrow.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
const arrow_map_throughAnArrow = (): Map<string, number> => map_throughAnArrow;
function plain_map_throughAnArrow(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAnArrow.get("a")));
    seen.push(show(map_throughAnArrow.has("zz")));
    seen.push(show(map_throughAnArrow.size));
    seen.push(show([...map_throughAnArrow.keys()]));
    seen.push(show(sumOf_map_throughAnArrow()));
    seen.push(show(eachOf_map_throughAnArrow()));
    return seen.join(" ");
}
function meddle_map_throughAnArrow(): void { alter(arrow_map_throughAnArrow()); }
const set_throughAnArrow: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAnArrow(): number { let t = 0; for (const k of set_throughAnArrow) t += k.length; return t; }
function eachOf_set_throughAnArrow(): number { let t = 0; set_throughAnArrow.forEach((k: string) => { t += k.length; }); return t; }
const arrow_set_throughAnArrow = (): Set<string> => set_throughAnArrow;
function plain_set_throughAnArrow(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAnArrow.has("zz")));
    seen.push(show(set_throughAnArrow.size));
    seen.push(show([...set_throughAnArrow]));
    seen.push(show(sumOf_set_throughAnArrow()));
    seen.push(show(eachOf_set_throughAnArrow()));
    return seen.join(" ");
}
function meddle_set_throughAnArrow(): void { alter(arrow_set_throughAnArrow()); }
const array_throughALiteral: number[] = [3, 1, 2];
function sumOf_array_throughALiteral(): number { let t = 0; for (const x of array_throughALiteral) t += x; return t; }
function eachOf_array_throughALiteral(): number { let t = 0; array_throughALiteral.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughALiteral(): string {
    const seen: string[] = [];
    seen.push(show(array_throughALiteral.map((x: number) => x * 2)));
    seen.push(show(array_throughALiteral.includes(99)));
    seen.push(show(array_throughALiteral.join("-")));
    seen.push(show(array_throughALiteral.some((x: number) => x > 50)));
    seen.push(show(array_throughALiteral.length));
    seen.push(show([...array_throughALiteral]));
    seen.push(show(sumOf_array_throughALiteral()));
    seen.push(show(eachOf_array_throughALiteral()));
    seen.push(show(array_throughALiteral.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughALiteral(): void { const both = [array_throughALiteral]; alter(both[0]); }
const map_throughALiteral: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughALiteral(): number { let t = 0; for (const [k, v] of map_throughALiteral) t += v + k.length; return t; }
function eachOf_map_throughALiteral(): number { let t = 0; map_throughALiteral.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughALiteral(): string {
    const seen: string[] = [];
    seen.push(show(map_throughALiteral.get("a")));
    seen.push(show(map_throughALiteral.has("zz")));
    seen.push(show(map_throughALiteral.size));
    seen.push(show([...map_throughALiteral.keys()]));
    seen.push(show(sumOf_map_throughALiteral()));
    seen.push(show(eachOf_map_throughALiteral()));
    return seen.join(" ");
}
function meddle_map_throughALiteral(): void { const both = [map_throughALiteral]; alter(both[0]); }
const set_throughALiteral: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughALiteral(): number { let t = 0; for (const k of set_throughALiteral) t += k.length; return t; }
function eachOf_set_throughALiteral(): number { let t = 0; set_throughALiteral.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughALiteral(): string {
    const seen: string[] = [];
    seen.push(show(set_throughALiteral.has("zz")));
    seen.push(show(set_throughALiteral.size));
    seen.push(show([...set_throughALiteral]));
    seen.push(show(sumOf_set_throughALiteral()));
    seen.push(show(eachOf_set_throughALiteral()));
    return seen.join(" ");
}
function meddle_set_throughALiteral(): void { const both = [set_throughALiteral]; alter(both[0]); }
const array_throughAnObjectLiteral: number[] = [3, 1, 2];
function sumOf_array_throughAnObjectLiteral(): number { let t = 0; for (const x of array_throughAnObjectLiteral) t += x; return t; }
function eachOf_array_throughAnObjectLiteral(): number { let t = 0; array_throughAnObjectLiteral.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAnObjectLiteral(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAnObjectLiteral.map((x: number) => x * 2)));
    seen.push(show(array_throughAnObjectLiteral.includes(99)));
    seen.push(show(array_throughAnObjectLiteral.join("-")));
    seen.push(show(array_throughAnObjectLiteral.some((x: number) => x > 50)));
    seen.push(show(array_throughAnObjectLiteral.length));
    seen.push(show([...array_throughAnObjectLiteral]));
    seen.push(show(sumOf_array_throughAnObjectLiteral()));
    seen.push(show(eachOf_array_throughAnObjectLiteral()));
    seen.push(show(array_throughAnObjectLiteral.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAnObjectLiteral(): void { const o = { v: array_throughAnObjectLiteral }; alter(o.v); }
const map_throughAnObjectLiteral: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAnObjectLiteral(): number { let t = 0; for (const [k, v] of map_throughAnObjectLiteral) t += v + k.length; return t; }
function eachOf_map_throughAnObjectLiteral(): number { let t = 0; map_throughAnObjectLiteral.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAnObjectLiteral(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAnObjectLiteral.get("a")));
    seen.push(show(map_throughAnObjectLiteral.has("zz")));
    seen.push(show(map_throughAnObjectLiteral.size));
    seen.push(show([...map_throughAnObjectLiteral.keys()]));
    seen.push(show(sumOf_map_throughAnObjectLiteral()));
    seen.push(show(eachOf_map_throughAnObjectLiteral()));
    return seen.join(" ");
}
function meddle_map_throughAnObjectLiteral(): void { const o = { v: map_throughAnObjectLiteral }; alter(o.v); }
const set_throughAnObjectLiteral: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAnObjectLiteral(): number { let t = 0; for (const k of set_throughAnObjectLiteral) t += k.length; return t; }
function eachOf_set_throughAnObjectLiteral(): number { let t = 0; set_throughAnObjectLiteral.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAnObjectLiteral(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAnObjectLiteral.has("zz")));
    seen.push(show(set_throughAnObjectLiteral.size));
    seen.push(show([...set_throughAnObjectLiteral]));
    seen.push(show(sumOf_set_throughAnObjectLiteral()));
    seen.push(show(eachOf_set_throughAnObjectLiteral()));
    return seen.join(" ");
}
function meddle_set_throughAnObjectLiteral(): void { const o = { v: set_throughAnObjectLiteral }; alter(o.v); }
const array_throughSpreadArguments: number[] = [3, 1, 2];
function sumOf_array_throughSpreadArguments(): number { let t = 0; for (const x of array_throughSpreadArguments) t += x; return t; }
function eachOf_array_throughSpreadArguments(): number { let t = 0; array_throughSpreadArguments.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughSpreadArguments(): string {
    const seen: string[] = [];
    seen.push(show(array_throughSpreadArguments.map((x: number) => x * 2)));
    seen.push(show(array_throughSpreadArguments.includes(99)));
    seen.push(show(array_throughSpreadArguments.join("-")));
    seen.push(show(array_throughSpreadArguments.some((x: number) => x > 50)));
    seen.push(show(array_throughSpreadArguments.length));
    seen.push(show([...array_throughSpreadArguments]));
    seen.push(show(sumOf_array_throughSpreadArguments()));
    seen.push(show(eachOf_array_throughSpreadArguments()));
    seen.push(show(array_throughSpreadArguments.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughSpreadArguments(): void { alterFirst(...[array_throughSpreadArguments]); }
const map_throughSpreadArguments: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughSpreadArguments(): number { let t = 0; for (const [k, v] of map_throughSpreadArguments) t += v + k.length; return t; }
function eachOf_map_throughSpreadArguments(): number { let t = 0; map_throughSpreadArguments.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughSpreadArguments(): string {
    const seen: string[] = [];
    seen.push(show(map_throughSpreadArguments.get("a")));
    seen.push(show(map_throughSpreadArguments.has("zz")));
    seen.push(show(map_throughSpreadArguments.size));
    seen.push(show([...map_throughSpreadArguments.keys()]));
    seen.push(show(sumOf_map_throughSpreadArguments()));
    seen.push(show(eachOf_map_throughSpreadArguments()));
    return seen.join(" ");
}
function meddle_map_throughSpreadArguments(): void { alterFirst(...[map_throughSpreadArguments]); }
const set_throughSpreadArguments: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughSpreadArguments(): number { let t = 0; for (const k of set_throughSpreadArguments) t += k.length; return t; }
function eachOf_set_throughSpreadArguments(): number { let t = 0; set_throughSpreadArguments.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughSpreadArguments(): string {
    const seen: string[] = [];
    seen.push(show(set_throughSpreadArguments.has("zz")));
    seen.push(show(set_throughSpreadArguments.size));
    seen.push(show([...set_throughSpreadArguments]));
    seen.push(show(sumOf_set_throughSpreadArguments()));
    seen.push(show(eachOf_set_throughSpreadArguments()));
    return seen.join(" ");
}
function meddle_set_throughSpreadArguments(): void { alterFirst(...[set_throughSpreadArguments]); }
const array_throughThis: number[] = [3, 1, 2];
function sumOf_array_throughThis(): number { let t = 0; for (const x of array_throughThis) t += x; return t; }
function eachOf_array_throughThis(): number { let t = 0; array_throughThis.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughThis(): string {
    const seen: string[] = [];
    seen.push(show(array_throughThis.map((x: number) => x * 2)));
    seen.push(show(array_throughThis.includes(99)));
    seen.push(show(array_throughThis.join("-")));
    seen.push(show(array_throughThis.some((x: number) => x > 50)));
    seen.push(show(array_throughThis.length));
    seen.push(show([...array_throughThis]));
    seen.push(show(sumOf_array_throughThis()));
    seen.push(show(eachOf_array_throughThis()));
    seen.push(show(array_throughThis.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughThis(): void { alterThis.call(array_throughThis); }
const map_throughThis: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughThis(): number { let t = 0; for (const [k, v] of map_throughThis) t += v + k.length; return t; }
function eachOf_map_throughThis(): number { let t = 0; map_throughThis.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughThis(): string {
    const seen: string[] = [];
    seen.push(show(map_throughThis.get("a")));
    seen.push(show(map_throughThis.has("zz")));
    seen.push(show(map_throughThis.size));
    seen.push(show([...map_throughThis.keys()]));
    seen.push(show(sumOf_map_throughThis()));
    seen.push(show(eachOf_map_throughThis()));
    return seen.join(" ");
}
function meddle_map_throughThis(): void { alterThis.call(map_throughThis); }
const set_throughThis: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughThis(): number { let t = 0; for (const k of set_throughThis) t += k.length; return t; }
function eachOf_set_throughThis(): number { let t = 0; set_throughThis.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughThis(): string {
    const seen: string[] = [];
    seen.push(show(set_throughThis.has("zz")));
    seen.push(show(set_throughThis.size));
    seen.push(show([...set_throughThis]));
    seen.push(show(sumOf_set_throughThis()));
    seen.push(show(eachOf_set_throughThis()));
    return seen.join(" ");
}
function meddle_set_throughThis(): void { alterThis.call(set_throughThis); }
const array_throughApply: number[] = [3, 1, 2];
function sumOf_array_throughApply(): number { let t = 0; for (const x of array_throughApply) t += x; return t; }
function eachOf_array_throughApply(): number { let t = 0; array_throughApply.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughApply(): string {
    const seen: string[] = [];
    seen.push(show(array_throughApply.map((x: number) => x * 2)));
    seen.push(show(array_throughApply.includes(99)));
    seen.push(show(array_throughApply.join("-")));
    seen.push(show(array_throughApply.some((x: number) => x > 50)));
    seen.push(show(array_throughApply.length));
    seen.push(show([...array_throughApply]));
    seen.push(show(sumOf_array_throughApply()));
    seen.push(show(eachOf_array_throughApply()));
    seen.push(show(array_throughApply.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughApply(): void { alterThis.apply(array_throughApply, []); }
const map_throughApply: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughApply(): number { let t = 0; for (const [k, v] of map_throughApply) t += v + k.length; return t; }
function eachOf_map_throughApply(): number { let t = 0; map_throughApply.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughApply(): string {
    const seen: string[] = [];
    seen.push(show(map_throughApply.get("a")));
    seen.push(show(map_throughApply.has("zz")));
    seen.push(show(map_throughApply.size));
    seen.push(show([...map_throughApply.keys()]));
    seen.push(show(sumOf_map_throughApply()));
    seen.push(show(eachOf_map_throughApply()));
    return seen.join(" ");
}
function meddle_map_throughApply(): void { alterThis.apply(map_throughApply, []); }
const set_throughApply: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughApply(): number { let t = 0; for (const k of set_throughApply) t += k.length; return t; }
function eachOf_set_throughApply(): number { let t = 0; set_throughApply.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughApply(): string {
    const seen: string[] = [];
    seen.push(show(set_throughApply.has("zz")));
    seen.push(show(set_throughApply.size));
    seen.push(show([...set_throughApply]));
    seen.push(show(sumOf_set_throughApply()));
    seen.push(show(eachOf_set_throughApply()));
    return seen.join(" ");
}
function meddle_set_throughApply(): void { alterThis.apply(set_throughApply, []); }
const array_throughBind: number[] = [3, 1, 2];
function sumOf_array_throughBind(): number { let t = 0; for (const x of array_throughBind) t += x; return t; }
function eachOf_array_throughBind(): number { let t = 0; array_throughBind.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughBind(): string {
    const seen: string[] = [];
    seen.push(show(array_throughBind.map((x: number) => x * 2)));
    seen.push(show(array_throughBind.includes(99)));
    seen.push(show(array_throughBind.join("-")));
    seen.push(show(array_throughBind.some((x: number) => x > 50)));
    seen.push(show(array_throughBind.length));
    seen.push(show([...array_throughBind]));
    seen.push(show(sumOf_array_throughBind()));
    seen.push(show(eachOf_array_throughBind()));
    seen.push(show(array_throughBind.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughBind(): void { alterThis.bind(array_throughBind)(); }
const map_throughBind: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughBind(): number { let t = 0; for (const [k, v] of map_throughBind) t += v + k.length; return t; }
function eachOf_map_throughBind(): number { let t = 0; map_throughBind.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughBind(): string {
    const seen: string[] = [];
    seen.push(show(map_throughBind.get("a")));
    seen.push(show(map_throughBind.has("zz")));
    seen.push(show(map_throughBind.size));
    seen.push(show([...map_throughBind.keys()]));
    seen.push(show(sumOf_map_throughBind()));
    seen.push(show(eachOf_map_throughBind()));
    return seen.join(" ");
}
function meddle_map_throughBind(): void { alterThis.bind(map_throughBind)(); }
const set_throughBind: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughBind(): number { let t = 0; for (const k of set_throughBind) t += k.length; return t; }
function eachOf_set_throughBind(): number { let t = 0; set_throughBind.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughBind(): string {
    const seen: string[] = [];
    seen.push(show(set_throughBind.has("zz")));
    seen.push(show(set_throughBind.size));
    seen.push(show([...set_throughBind]));
    seen.push(show(sumOf_set_throughBind()));
    seen.push(show(eachOf_set_throughBind()));
    return seen.join(" ");
}
function meddle_set_throughBind(): void { alterThis.bind(set_throughBind)(); }
const array_throughReflectApply: number[] = [3, 1, 2];
function sumOf_array_throughReflectApply(): number { let t = 0; for (const x of array_throughReflectApply) t += x; return t; }
function eachOf_array_throughReflectApply(): number { let t = 0; array_throughReflectApply.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughReflectApply(): string {
    const seen: string[] = [];
    seen.push(show(array_throughReflectApply.map((x: number) => x * 2)));
    seen.push(show(array_throughReflectApply.includes(99)));
    seen.push(show(array_throughReflectApply.join("-")));
    seen.push(show(array_throughReflectApply.some((x: number) => x > 50)));
    seen.push(show(array_throughReflectApply.length));
    seen.push(show([...array_throughReflectApply]));
    seen.push(show(sumOf_array_throughReflectApply()));
    seen.push(show(eachOf_array_throughReflectApply()));
    seen.push(show(array_throughReflectApply.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughReflectApply(): void { Reflect.apply(alter, undefined, [array_throughReflectApply]); }
const map_throughReflectApply: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughReflectApply(): number { let t = 0; for (const [k, v] of map_throughReflectApply) t += v + k.length; return t; }
function eachOf_map_throughReflectApply(): number { let t = 0; map_throughReflectApply.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughReflectApply(): string {
    const seen: string[] = [];
    seen.push(show(map_throughReflectApply.get("a")));
    seen.push(show(map_throughReflectApply.has("zz")));
    seen.push(show(map_throughReflectApply.size));
    seen.push(show([...map_throughReflectApply.keys()]));
    seen.push(show(sumOf_map_throughReflectApply()));
    seen.push(show(eachOf_map_throughReflectApply()));
    return seen.join(" ");
}
function meddle_map_throughReflectApply(): void { Reflect.apply(alter, undefined, [map_throughReflectApply]); }
const set_throughReflectApply: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughReflectApply(): number { let t = 0; for (const k of set_throughReflectApply) t += k.length; return t; }
function eachOf_set_throughReflectApply(): number { let t = 0; set_throughReflectApply.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughReflectApply(): string {
    const seen: string[] = [];
    seen.push(show(set_throughReflectApply.has("zz")));
    seen.push(show(set_throughReflectApply.size));
    seen.push(show([...set_throughReflectApply]));
    seen.push(show(sumOf_set_throughReflectApply()));
    seen.push(show(eachOf_set_throughReflectApply()));
    return seen.join(" ");
}
function meddle_set_throughReflectApply(): void { Reflect.apply(alter, undefined, [set_throughReflectApply]); }
const array_thrownAndCaught: number[] = [3, 1, 2];
function sumOf_array_thrownAndCaught(): number { let t = 0; for (const x of array_thrownAndCaught) t += x; return t; }
function eachOf_array_thrownAndCaught(): number { let t = 0; array_thrownAndCaught.forEach((x: number) => { t += x; }); return t; }
function plain_array_thrownAndCaught(): string {
    const seen: string[] = [];
    seen.push(show(array_thrownAndCaught.map((x: number) => x * 2)));
    seen.push(show(array_thrownAndCaught.includes(99)));
    seen.push(show(array_thrownAndCaught.join("-")));
    seen.push(show(array_thrownAndCaught.some((x: number) => x > 50)));
    seen.push(show(array_thrownAndCaught.length));
    seen.push(show([...array_thrownAndCaught]));
    seen.push(show(sumOf_array_thrownAndCaught()));
    seen.push(show(eachOf_array_thrownAndCaught()));
    seen.push(show(array_thrownAndCaught.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_thrownAndCaught(): void { try { throw array_thrownAndCaught; } catch (e) { alter(e); } }
const map_thrownAndCaught: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_thrownAndCaught(): number { let t = 0; for (const [k, v] of map_thrownAndCaught) t += v + k.length; return t; }
function eachOf_map_thrownAndCaught(): number { let t = 0; map_thrownAndCaught.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_thrownAndCaught(): string {
    const seen: string[] = [];
    seen.push(show(map_thrownAndCaught.get("a")));
    seen.push(show(map_thrownAndCaught.has("zz")));
    seen.push(show(map_thrownAndCaught.size));
    seen.push(show([...map_thrownAndCaught.keys()]));
    seen.push(show(sumOf_map_thrownAndCaught()));
    seen.push(show(eachOf_map_thrownAndCaught()));
    return seen.join(" ");
}
function meddle_map_thrownAndCaught(): void { try { throw map_thrownAndCaught; } catch (e) { alter(e); } }
const set_thrownAndCaught: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_thrownAndCaught(): number { let t = 0; for (const k of set_thrownAndCaught) t += k.length; return t; }
function eachOf_set_thrownAndCaught(): number { let t = 0; set_thrownAndCaught.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_thrownAndCaught(): string {
    const seen: string[] = [];
    seen.push(show(set_thrownAndCaught.has("zz")));
    seen.push(show(set_thrownAndCaught.size));
    seen.push(show([...set_thrownAndCaught]));
    seen.push(show(sumOf_set_thrownAndCaught()));
    seen.push(show(eachOf_set_thrownAndCaught()));
    return seen.join(" ");
}
function meddle_set_thrownAndCaught(): void { try { throw set_thrownAndCaught; } catch (e) { alter(e); } }
const array_throughAJoin: number[] = [3, 1, 2];
function sumOf_array_throughAJoin(): number { let t = 0; for (const x of array_throughAJoin) t += x; return t; }
function eachOf_array_throughAJoin(): number { let t = 0; array_throughAJoin.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAJoin(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAJoin.map((x: number) => x * 2)));
    seen.push(show(array_throughAJoin.includes(99)));
    seen.push(show(array_throughAJoin.join("-")));
    seen.push(show(array_throughAJoin.some((x: number) => x > 50)));
    seen.push(show(array_throughAJoin.length));
    seen.push(show([...array_throughAJoin]));
    seen.push(show(sumOf_array_throughAJoin()));
    seen.push(show(eachOf_array_throughAJoin()));
    seen.push(show(array_throughAJoin.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAJoin(): void { const w: any = yes ? array_throughAJoin : holder; alter(w); }
const map_throughAJoin: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAJoin(): number { let t = 0; for (const [k, v] of map_throughAJoin) t += v + k.length; return t; }
function eachOf_map_throughAJoin(): number { let t = 0; map_throughAJoin.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAJoin(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAJoin.get("a")));
    seen.push(show(map_throughAJoin.has("zz")));
    seen.push(show(map_throughAJoin.size));
    seen.push(show([...map_throughAJoin.keys()]));
    seen.push(show(sumOf_map_throughAJoin()));
    seen.push(show(eachOf_map_throughAJoin()));
    return seen.join(" ");
}
function meddle_map_throughAJoin(): void { const w: any = yes ? map_throughAJoin : holder; alter(w); }
const set_throughAJoin: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAJoin(): number { let t = 0; for (const k of set_throughAJoin) t += k.length; return t; }
function eachOf_set_throughAJoin(): number { let t = 0; set_throughAJoin.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAJoin(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAJoin.has("zz")));
    seen.push(show(set_throughAJoin.size));
    seen.push(show([...set_throughAJoin]));
    seen.push(show(sumOf_set_throughAJoin()));
    seen.push(show(eachOf_set_throughAJoin()));
    return seen.join(" ");
}
function meddle_set_throughAJoin(): void { const w: any = yes ? set_throughAJoin : holder; alter(w); }
const array_throughAJoinNotTaken: number[] = [3, 1, 2];
function sumOf_array_throughAJoinNotTaken(): number { let t = 0; for (const x of array_throughAJoinNotTaken) t += x; return t; }
function eachOf_array_throughAJoinNotTaken(): number { let t = 0; array_throughAJoinNotTaken.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAJoinNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAJoinNotTaken.map((x: number) => x * 2)));
    seen.push(show(array_throughAJoinNotTaken.includes(99)));
    seen.push(show(array_throughAJoinNotTaken.join("-")));
    seen.push(show(array_throughAJoinNotTaken.some((x: number) => x > 50)));
    seen.push(show(array_throughAJoinNotTaken.length));
    seen.push(show([...array_throughAJoinNotTaken]));
    seen.push(show(sumOf_array_throughAJoinNotTaken()));
    seen.push(show(eachOf_array_throughAJoinNotTaken()));
    seen.push(show(array_throughAJoinNotTaken.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAJoinNotTaken(): void { const w: any = no ? array_throughAJoinNotTaken : holder; alter(w); }
const map_throughAJoinNotTaken: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAJoinNotTaken(): number { let t = 0; for (const [k, v] of map_throughAJoinNotTaken) t += v + k.length; return t; }
function eachOf_map_throughAJoinNotTaken(): number { let t = 0; map_throughAJoinNotTaken.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAJoinNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAJoinNotTaken.get("a")));
    seen.push(show(map_throughAJoinNotTaken.has("zz")));
    seen.push(show(map_throughAJoinNotTaken.size));
    seen.push(show([...map_throughAJoinNotTaken.keys()]));
    seen.push(show(sumOf_map_throughAJoinNotTaken()));
    seen.push(show(eachOf_map_throughAJoinNotTaken()));
    return seen.join(" ");
}
function meddle_map_throughAJoinNotTaken(): void { const w: any = no ? map_throughAJoinNotTaken : holder; alter(w); }
const set_throughAJoinNotTaken: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAJoinNotTaken(): number { let t = 0; for (const k of set_throughAJoinNotTaken) t += k.length; return t; }
function eachOf_set_throughAJoinNotTaken(): number { let t = 0; set_throughAJoinNotTaken.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAJoinNotTaken(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAJoinNotTaken.has("zz")));
    seen.push(show(set_throughAJoinNotTaken.size));
    seen.push(show([...set_throughAJoinNotTaken]));
    seen.push(show(sumOf_set_throughAJoinNotTaken()));
    seen.push(show(eachOf_set_throughAJoinNotTaken()));
    return seen.join(" ");
}
function meddle_set_throughAJoinNotTaken(): void { const w: any = no ? set_throughAJoinNotTaken : holder; alter(w); }
const array_throughNullish: number[] = [3, 1, 2];
function sumOf_array_throughNullish(): number { let t = 0; for (const x of array_throughNullish) t += x; return t; }
function eachOf_array_throughNullish(): number { let t = 0; array_throughNullish.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughNullish(): string {
    const seen: string[] = [];
    seen.push(show(array_throughNullish.map((x: number) => x * 2)));
    seen.push(show(array_throughNullish.includes(99)));
    seen.push(show(array_throughNullish.join("-")));
    seen.push(show(array_throughNullish.some((x: number) => x > 50)));
    seen.push(show(array_throughNullish.length));
    seen.push(show([...array_throughNullish]));
    seen.push(show(sumOf_array_throughNullish()));
    seen.push(show(eachOf_array_throughNullish()));
    seen.push(show(array_throughNullish.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughNullish(): void { const w: any = (no ? undefined : array_throughNullish) ?? holder; alter(w); }
const map_throughNullish: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughNullish(): number { let t = 0; for (const [k, v] of map_throughNullish) t += v + k.length; return t; }
function eachOf_map_throughNullish(): number { let t = 0; map_throughNullish.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughNullish(): string {
    const seen: string[] = [];
    seen.push(show(map_throughNullish.get("a")));
    seen.push(show(map_throughNullish.has("zz")));
    seen.push(show(map_throughNullish.size));
    seen.push(show([...map_throughNullish.keys()]));
    seen.push(show(sumOf_map_throughNullish()));
    seen.push(show(eachOf_map_throughNullish()));
    return seen.join(" ");
}
function meddle_map_throughNullish(): void { const w: any = (no ? undefined : map_throughNullish) ?? holder; alter(w); }
const set_throughNullish: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughNullish(): number { let t = 0; for (const k of set_throughNullish) t += k.length; return t; }
function eachOf_set_throughNullish(): number { let t = 0; set_throughNullish.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughNullish(): string {
    const seen: string[] = [];
    seen.push(show(set_throughNullish.has("zz")));
    seen.push(show(set_throughNullish.size));
    seen.push(show([...set_throughNullish]));
    seen.push(show(sumOf_set_throughNullish()));
    seen.push(show(eachOf_set_throughNullish()));
    return seen.join(" ");
}
function meddle_set_throughNullish(): void { const w: any = (no ? undefined : set_throughNullish) ?? holder; alter(w); }
const array_throughDestructuring: number[] = [3, 1, 2];
function sumOf_array_throughDestructuring(): number { let t = 0; for (const x of array_throughDestructuring) t += x; return t; }
function eachOf_array_throughDestructuring(): number { let t = 0; array_throughDestructuring.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughDestructuring(): string {
    const seen: string[] = [];
    seen.push(show(array_throughDestructuring.map((x: number) => x * 2)));
    seen.push(show(array_throughDestructuring.includes(99)));
    seen.push(show(array_throughDestructuring.join("-")));
    seen.push(show(array_throughDestructuring.some((x: number) => x > 50)));
    seen.push(show(array_throughDestructuring.length));
    seen.push(show([...array_throughDestructuring]));
    seen.push(show(sumOf_array_throughDestructuring()));
    seen.push(show(eachOf_array_throughDestructuring()));
    seen.push(show(array_throughDestructuring.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughDestructuring(): void { const [first] = [array_throughDestructuring]; alter(first); }
const map_throughDestructuring: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughDestructuring(): number { let t = 0; for (const [k, v] of map_throughDestructuring) t += v + k.length; return t; }
function eachOf_map_throughDestructuring(): number { let t = 0; map_throughDestructuring.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughDestructuring(): string {
    const seen: string[] = [];
    seen.push(show(map_throughDestructuring.get("a")));
    seen.push(show(map_throughDestructuring.has("zz")));
    seen.push(show(map_throughDestructuring.size));
    seen.push(show([...map_throughDestructuring.keys()]));
    seen.push(show(sumOf_map_throughDestructuring()));
    seen.push(show(eachOf_map_throughDestructuring()));
    return seen.join(" ");
}
function meddle_map_throughDestructuring(): void { const [first] = [map_throughDestructuring]; alter(first); }
const set_throughDestructuring: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughDestructuring(): number { let t = 0; for (const k of set_throughDestructuring) t += k.length; return t; }
function eachOf_set_throughDestructuring(): number { let t = 0; set_throughDestructuring.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughDestructuring(): string {
    const seen: string[] = [];
    seen.push(show(set_throughDestructuring.has("zz")));
    seen.push(show(set_throughDestructuring.size));
    seen.push(show([...set_throughDestructuring]));
    seen.push(show(sumOf_set_throughDestructuring()));
    seen.push(show(eachOf_set_throughDestructuring()));
    return seen.join(" ");
}
function meddle_set_throughDestructuring(): void { const [first] = [set_throughDestructuring]; alter(first); }
const array_throughAProxy: number[] = [3, 1, 2];
function sumOf_array_throughAProxy(): number { let t = 0; for (const x of array_throughAProxy) t += x; return t; }
function eachOf_array_throughAProxy(): number { let t = 0; array_throughAProxy.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAProxy(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAProxy.map((x: number) => x * 2)));
    seen.push(show(array_throughAProxy.includes(99)));
    seen.push(show(array_throughAProxy.join("-")));
    seen.push(show(array_throughAProxy.some((x: number) => x > 50)));
    seen.push(show(array_throughAProxy.length));
    seen.push(show([...array_throughAProxy]));
    seen.push(show(sumOf_array_throughAProxy()));
    seen.push(show(eachOf_array_throughAProxy()));
    seen.push(show(array_throughAProxy.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAProxy(): void { const p: any = new Proxy(array_throughAProxy, {}); p.map = () => [-41]; }
const map_throughAProxy: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAProxy(): number { let t = 0; for (const [k, v] of map_throughAProxy) t += v + k.length; return t; }
function eachOf_map_throughAProxy(): number { let t = 0; map_throughAProxy.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAProxy(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAProxy.get("a")));
    seen.push(show(map_throughAProxy.has("zz")));
    seen.push(show(map_throughAProxy.size));
    seen.push(show([...map_throughAProxy.keys()]));
    seen.push(show(sumOf_map_throughAProxy()));
    seen.push(show(eachOf_map_throughAProxy()));
    return seen.join(" ");
}
function meddle_map_throughAProxy(): void { const p: any = new Proxy(map_throughAProxy, {}); p.get = () => -41; }
const set_throughAProxy: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAProxy(): number { let t = 0; for (const k of set_throughAProxy) t += k.length; return t; }
function eachOf_set_throughAProxy(): number { let t = 0; set_throughAProxy.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAProxy(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAProxy.has("zz")));
    seen.push(show(set_throughAProxy.size));
    seen.push(show([...set_throughAProxy]));
    seen.push(show(sumOf_set_throughAProxy()));
    seen.push(show(eachOf_set_throughAProxy()));
    return seen.join(" ");
}
function meddle_set_throughAProxy(): void { const p: any = new Proxy(set_throughAProxy, {}); p.has = () => true; }
const array_throughAWeakRef: number[] = [3, 1, 2];
function sumOf_array_throughAWeakRef(): number { let t = 0; for (const x of array_throughAWeakRef) t += x; return t; }
function eachOf_array_throughAWeakRef(): number { let t = 0; array_throughAWeakRef.forEach((x: number) => { t += x; }); return t; }
function plain_array_throughAWeakRef(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAWeakRef.map((x: number) => x * 2)));
    seen.push(show(array_throughAWeakRef.includes(99)));
    seen.push(show(array_throughAWeakRef.join("-")));
    seen.push(show(array_throughAWeakRef.some((x: number) => x > 50)));
    seen.push(show(array_throughAWeakRef.length));
    seen.push(show([...array_throughAWeakRef]));
    seen.push(show(sumOf_array_throughAWeakRef()));
    seen.push(show(eachOf_array_throughAWeakRef()));
    seen.push(show(array_throughAWeakRef.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAWeakRef(): void { alter(new WeakRef(array_throughAWeakRef).deref()); }
const map_throughAWeakRef: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAWeakRef(): number { let t = 0; for (const [k, v] of map_throughAWeakRef) t += v + k.length; return t; }
function eachOf_map_throughAWeakRef(): number { let t = 0; map_throughAWeakRef.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_throughAWeakRef(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAWeakRef.get("a")));
    seen.push(show(map_throughAWeakRef.has("zz")));
    seen.push(show(map_throughAWeakRef.size));
    seen.push(show([...map_throughAWeakRef.keys()]));
    seen.push(show(sumOf_map_throughAWeakRef()));
    seen.push(show(eachOf_map_throughAWeakRef()));
    return seen.join(" ");
}
function meddle_map_throughAWeakRef(): void { alter(new WeakRef(map_throughAWeakRef).deref()); }
const set_throughAWeakRef: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAWeakRef(): number { let t = 0; for (const k of set_throughAWeakRef) t += k.length; return t; }
function eachOf_set_throughAWeakRef(): number { let t = 0; set_throughAWeakRef.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_throughAWeakRef(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAWeakRef.has("zz")));
    seen.push(show(set_throughAWeakRef.size));
    seen.push(show([...set_throughAWeakRef]));
    seen.push(show(sumOf_set_throughAWeakRef()));
    seen.push(show(eachOf_set_throughAWeakRef()));
    return seen.join(" ");
}
function meddle_set_throughAWeakRef(): void { alter(new WeakRef(set_throughAWeakRef).deref()); }
const array_throughAClosureMadeEarly: number[] = [3, 1, 2];
function sumOf_array_throughAClosureMadeEarly(): number { let t = 0; for (const x of array_throughAClosureMadeEarly) t += x; return t; }
function eachOf_array_throughAClosureMadeEarly(): number { let t = 0; array_throughAClosureMadeEarly.forEach((x: number) => { t += x; }); return t; }
const early_array_throughAClosureMadeEarly = { run(): void { alter(array_throughAClosureMadeEarly); } };
function plain_array_throughAClosureMadeEarly(): string {
    const seen: string[] = [];
    seen.push(show(array_throughAClosureMadeEarly.map((x: number) => x * 2)));
    seen.push(show(array_throughAClosureMadeEarly.includes(99)));
    seen.push(show(array_throughAClosureMadeEarly.join("-")));
    seen.push(show(array_throughAClosureMadeEarly.some((x: number) => x > 50)));
    seen.push(show(array_throughAClosureMadeEarly.length));
    seen.push(show([...array_throughAClosureMadeEarly]));
    seen.push(show(sumOf_array_throughAClosureMadeEarly()));
    seen.push(show(eachOf_array_throughAClosureMadeEarly()));
    seen.push(show(array_throughAClosureMadeEarly.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_throughAClosureMadeEarly(): void { early_array_throughAClosureMadeEarly.run(); }
const map_throughAClosureMadeEarly: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_throughAClosureMadeEarly(): number { let t = 0; for (const [k, v] of map_throughAClosureMadeEarly) t += v + k.length; return t; }
function eachOf_map_throughAClosureMadeEarly(): number { let t = 0; map_throughAClosureMadeEarly.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
const early_map_throughAClosureMadeEarly = { run(): void { alter(map_throughAClosureMadeEarly); } };
function plain_map_throughAClosureMadeEarly(): string {
    const seen: string[] = [];
    seen.push(show(map_throughAClosureMadeEarly.get("a")));
    seen.push(show(map_throughAClosureMadeEarly.has("zz")));
    seen.push(show(map_throughAClosureMadeEarly.size));
    seen.push(show([...map_throughAClosureMadeEarly.keys()]));
    seen.push(show(sumOf_map_throughAClosureMadeEarly()));
    seen.push(show(eachOf_map_throughAClosureMadeEarly()));
    return seen.join(" ");
}
function meddle_map_throughAClosureMadeEarly(): void { early_map_throughAClosureMadeEarly.run(); }
const set_throughAClosureMadeEarly: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_throughAClosureMadeEarly(): number { let t = 0; for (const k of set_throughAClosureMadeEarly) t += k.length; return t; }
function eachOf_set_throughAClosureMadeEarly(): number { let t = 0; set_throughAClosureMadeEarly.forEach((k: string) => { t += k.length; }); return t; }
const early_set_throughAClosureMadeEarly = { run(): void { alter(set_throughAClosureMadeEarly); } };
function plain_set_throughAClosureMadeEarly(): string {
    const seen: string[] = [];
    seen.push(show(set_throughAClosureMadeEarly.has("zz")));
    seen.push(show(set_throughAClosureMadeEarly.size));
    seen.push(show([...set_throughAClosureMadeEarly]));
    seen.push(show(sumOf_set_throughAClosureMadeEarly()));
    seen.push(show(eachOf_set_throughAClosureMadeEarly()));
    return seen.join(" ");
}
function meddle_set_throughAClosureMadeEarly(): void { early_set_throughAClosureMadeEarly.run(); }
const array_thirdParameter: number[] = [3, 1, 2];
function sumOf_array_thirdParameter(): number { let t = 0; for (const x of array_thirdParameter) t += x; return t; }
function eachOf_array_thirdParameter(): number { let t = 0; array_thirdParameter.forEach((x: number) => { t += x; }); return t; }
function plain_array_thirdParameter(): string {
    const seen: string[] = [];
    seen.push(show(array_thirdParameter.map((x: number) => x * 2)));
    seen.push(show(array_thirdParameter.includes(99)));
    seen.push(show(array_thirdParameter.join("-")));
    seen.push(show(array_thirdParameter.some((x: number) => x > 50)));
    seen.push(show(array_thirdParameter.length));
    seen.push(show([...array_thirdParameter]));
    seen.push(show(sumOf_array_thirdParameter()));
    seen.push(show(eachOf_array_thirdParameter()));
    seen.push(show(array_thirdParameter.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_thirdParameter(): void { array_thirdParameter.map((a: any, b: any, c: any) => { alter(c); return a; }); }
const map_thirdParameter: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_thirdParameter(): number { let t = 0; for (const [k, v] of map_thirdParameter) t += v + k.length; return t; }
function eachOf_map_thirdParameter(): number { let t = 0; map_thirdParameter.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_thirdParameter(): string {
    const seen: string[] = [];
    seen.push(show(map_thirdParameter.get("a")));
    seen.push(show(map_thirdParameter.has("zz")));
    seen.push(show(map_thirdParameter.size));
    seen.push(show([...map_thirdParameter.keys()]));
    seen.push(show(sumOf_map_thirdParameter()));
    seen.push(show(eachOf_map_thirdParameter()));
    return seen.join(" ");
}
function meddle_map_thirdParameter(): void { map_thirdParameter.forEach((a: any, b: any, c: any) => { alter(c); return a; }); }
const set_thirdParameter: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_thirdParameter(): number { let t = 0; for (const k of set_thirdParameter) t += k.length; return t; }
function eachOf_set_thirdParameter(): number { let t = 0; set_thirdParameter.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_thirdParameter(): string {
    const seen: string[] = [];
    seen.push(show(set_thirdParameter.has("zz")));
    seen.push(show(set_thirdParameter.size));
    seen.push(show([...set_thirdParameter]));
    seen.push(show(sumOf_set_thirdParameter()));
    seen.push(show(eachOf_set_thirdParameter()));
    return seen.join(" ");
}
function meddle_set_thirdParameter(): void { set_thirdParameter.forEach((a: any, b: any, c: any) => { alter(c); return a; }); }
const array_thirdParameterOfANamedFunction: number[] = [3, 1, 2];
function sumOf_array_thirdParameterOfANamedFunction(): number { let t = 0; for (const x of array_thirdParameterOfANamedFunction) t += x; return t; }
function eachOf_array_thirdParameterOfANamedFunction(): number { let t = 0; array_thirdParameterOfANamedFunction.forEach((x: number) => { t += x; }); return t; }
function third_array_thirdParameterOfANamedFunction(a: any, b: any, c: any): any { alter(c); return a; }
function plain_array_thirdParameterOfANamedFunction(): string {
    const seen: string[] = [];
    seen.push(show(array_thirdParameterOfANamedFunction.map((x: number) => x * 2)));
    seen.push(show(array_thirdParameterOfANamedFunction.includes(99)));
    seen.push(show(array_thirdParameterOfANamedFunction.join("-")));
    seen.push(show(array_thirdParameterOfANamedFunction.some((x: number) => x > 50)));
    seen.push(show(array_thirdParameterOfANamedFunction.length));
    seen.push(show([...array_thirdParameterOfANamedFunction]));
    seen.push(show(sumOf_array_thirdParameterOfANamedFunction()));
    seen.push(show(eachOf_array_thirdParameterOfANamedFunction()));
    seen.push(show(array_thirdParameterOfANamedFunction.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_thirdParameterOfANamedFunction(): void { array_thirdParameterOfANamedFunction.map(third_array_thirdParameterOfANamedFunction); }
const map_thirdParameterOfANamedFunction: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_thirdParameterOfANamedFunction(): number { let t = 0; for (const [k, v] of map_thirdParameterOfANamedFunction) t += v + k.length; return t; }
function eachOf_map_thirdParameterOfANamedFunction(): number { let t = 0; map_thirdParameterOfANamedFunction.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function third_map_thirdParameterOfANamedFunction(a: any, b: any, c: any): any { alter(c); return a; }
function plain_map_thirdParameterOfANamedFunction(): string {
    const seen: string[] = [];
    seen.push(show(map_thirdParameterOfANamedFunction.get("a")));
    seen.push(show(map_thirdParameterOfANamedFunction.has("zz")));
    seen.push(show(map_thirdParameterOfANamedFunction.size));
    seen.push(show([...map_thirdParameterOfANamedFunction.keys()]));
    seen.push(show(sumOf_map_thirdParameterOfANamedFunction()));
    seen.push(show(eachOf_map_thirdParameterOfANamedFunction()));
    return seen.join(" ");
}
function meddle_map_thirdParameterOfANamedFunction(): void { map_thirdParameterOfANamedFunction.forEach(third_map_thirdParameterOfANamedFunction); }
const set_thirdParameterOfANamedFunction: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_thirdParameterOfANamedFunction(): number { let t = 0; for (const k of set_thirdParameterOfANamedFunction) t += k.length; return t; }
function eachOf_set_thirdParameterOfANamedFunction(): number { let t = 0; set_thirdParameterOfANamedFunction.forEach((k: string) => { t += k.length; }); return t; }
function third_set_thirdParameterOfANamedFunction(a: any, b: any, c: any): any { alter(c); return a; }
function plain_set_thirdParameterOfANamedFunction(): string {
    const seen: string[] = [];
    seen.push(show(set_thirdParameterOfANamedFunction.has("zz")));
    seen.push(show(set_thirdParameterOfANamedFunction.size));
    seen.push(show([...set_thirdParameterOfANamedFunction]));
    seen.push(show(sumOf_set_thirdParameterOfANamedFunction()));
    seen.push(show(eachOf_set_thirdParameterOfANamedFunction()));
    return seen.join(" ");
}
function meddle_set_thirdParameterOfANamedFunction(): void { set_thirdParameterOfANamedFunction.forEach(third_set_thirdParameterOfANamedFunction); }
const array_argumentsObject: number[] = [3, 1, 2];
function sumOf_array_argumentsObject(): number { let t = 0; for (const x of array_argumentsObject) t += x; return t; }
function eachOf_array_argumentsObject(): number { let t = 0; array_argumentsObject.forEach((x: number) => { t += x; }); return t; }
function plain_array_argumentsObject(): string {
    const seen: string[] = [];
    seen.push(show(array_argumentsObject.map((x: number) => x * 2)));
    seen.push(show(array_argumentsObject.includes(99)));
    seen.push(show(array_argumentsObject.join("-")));
    seen.push(show(array_argumentsObject.some((x: number) => x > 50)));
    seen.push(show(array_argumentsObject.length));
    seen.push(show([...array_argumentsObject]));
    seen.push(show(sumOf_array_argumentsObject()));
    seen.push(show(eachOf_array_argumentsObject()));
    seen.push(show(array_argumentsObject.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_argumentsObject(): void { array_argumentsObject.map(function (a: any): any { alter(arguments[2]); return a; }); }
const map_argumentsObject: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_argumentsObject(): number { let t = 0; for (const [k, v] of map_argumentsObject) t += v + k.length; return t; }
function eachOf_map_argumentsObject(): number { let t = 0; map_argumentsObject.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_argumentsObject(): string {
    const seen: string[] = [];
    seen.push(show(map_argumentsObject.get("a")));
    seen.push(show(map_argumentsObject.has("zz")));
    seen.push(show(map_argumentsObject.size));
    seen.push(show([...map_argumentsObject.keys()]));
    seen.push(show(sumOf_map_argumentsObject()));
    seen.push(show(eachOf_map_argumentsObject()));
    return seen.join(" ");
}
function meddle_map_argumentsObject(): void { map_argumentsObject.forEach(function (a: any): any { alter(arguments[2]); return a; }); }
const set_argumentsObject: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_argumentsObject(): number { let t = 0; for (const k of set_argumentsObject) t += k.length; return t; }
function eachOf_set_argumentsObject(): number { let t = 0; set_argumentsObject.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_argumentsObject(): string {
    const seen: string[] = [];
    seen.push(show(set_argumentsObject.has("zz")));
    seen.push(show(set_argumentsObject.size));
    seen.push(show([...set_argumentsObject]));
    seen.push(show(sumOf_set_argumentsObject()));
    seen.push(show(eachOf_set_argumentsObject()));
    return seen.join(" ");
}
function meddle_set_argumentsObject(): void { set_argumentsObject.forEach(function (a: any): any { alter(arguments[2]); return a; }); }
const array_argumentsObjectByKey: number[] = [3, 1, 2];
function sumOf_array_argumentsObjectByKey(): number { let t = 0; for (const x of array_argumentsObjectByKey) t += x; return t; }
function eachOf_array_argumentsObjectByKey(): number { let t = 0; array_argumentsObjectByKey.forEach((x: number) => { t += x; }); return t; }
function plain_array_argumentsObjectByKey(): string {
    const seen: string[] = [];
    seen.push(show(array_argumentsObjectByKey.map((x: number) => x * 2)));
    seen.push(show(array_argumentsObjectByKey.includes(99)));
    seen.push(show(array_argumentsObjectByKey.join("-")));
    seen.push(show(array_argumentsObjectByKey.some((x: number) => x > 50)));
    seen.push(show(array_argumentsObjectByKey.length));
    seen.push(show([...array_argumentsObjectByKey]));
    seen.push(show(sumOf_array_argumentsObjectByKey()));
    seen.push(show(eachOf_array_argumentsObjectByKey()));
    seen.push(show(array_argumentsObjectByKey.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_argumentsObjectByKey(): void { const k: number = yes ? 2 : 0; array_argumentsObjectByKey.map(function (a: any): any { alter(arguments[k]); return a; }); }
const map_argumentsObjectByKey: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_argumentsObjectByKey(): number { let t = 0; for (const [k, v] of map_argumentsObjectByKey) t += v + k.length; return t; }
function eachOf_map_argumentsObjectByKey(): number { let t = 0; map_argumentsObjectByKey.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_argumentsObjectByKey(): string {
    const seen: string[] = [];
    seen.push(show(map_argumentsObjectByKey.get("a")));
    seen.push(show(map_argumentsObjectByKey.has("zz")));
    seen.push(show(map_argumentsObjectByKey.size));
    seen.push(show([...map_argumentsObjectByKey.keys()]));
    seen.push(show(sumOf_map_argumentsObjectByKey()));
    seen.push(show(eachOf_map_argumentsObjectByKey()));
    return seen.join(" ");
}
function meddle_map_argumentsObjectByKey(): void { const k: number = yes ? 2 : 0; map_argumentsObjectByKey.forEach(function (a: any): any { alter(arguments[k]); return a; }); }
const set_argumentsObjectByKey: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_argumentsObjectByKey(): number { let t = 0; for (const k of set_argumentsObjectByKey) t += k.length; return t; }
function eachOf_set_argumentsObjectByKey(): number { let t = 0; set_argumentsObjectByKey.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_argumentsObjectByKey(): string {
    const seen: string[] = [];
    seen.push(show(set_argumentsObjectByKey.has("zz")));
    seen.push(show(set_argumentsObjectByKey.size));
    seen.push(show([...set_argumentsObjectByKey]));
    seen.push(show(sumOf_set_argumentsObjectByKey()));
    seen.push(show(eachOf_set_argumentsObjectByKey()));
    return seen.join(" ");
}
function meddle_set_argumentsObjectByKey(): void { const k: number = yes ? 2 : 0; set_argumentsObjectByKey.forEach(function (a: any): any { alter(arguments[k]); return a; }); }
const array_restParameter: number[] = [3, 1, 2];
function sumOf_array_restParameter(): number { let t = 0; for (const x of array_restParameter) t += x; return t; }
function eachOf_array_restParameter(): number { let t = 0; array_restParameter.forEach((x: number) => { t += x; }); return t; }
function plain_array_restParameter(): string {
    const seen: string[] = [];
    seen.push(show(array_restParameter.map((x: number) => x * 2)));
    seen.push(show(array_restParameter.includes(99)));
    seen.push(show(array_restParameter.join("-")));
    seen.push(show(array_restParameter.some((x: number) => x > 50)));
    seen.push(show(array_restParameter.length));
    seen.push(show([...array_restParameter]));
    seen.push(show(sumOf_array_restParameter()));
    seen.push(show(eachOf_array_restParameter()));
    seen.push(show(array_restParameter.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_restParameter(): void { array_restParameter.map((...all: any[]) => { alter(all[2]); return all[0]; }); }
const map_restParameter: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_restParameter(): number { let t = 0; for (const [k, v] of map_restParameter) t += v + k.length; return t; }
function eachOf_map_restParameter(): number { let t = 0; map_restParameter.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_restParameter(): string {
    const seen: string[] = [];
    seen.push(show(map_restParameter.get("a")));
    seen.push(show(map_restParameter.has("zz")));
    seen.push(show(map_restParameter.size));
    seen.push(show([...map_restParameter.keys()]));
    seen.push(show(sumOf_map_restParameter()));
    seen.push(show(eachOf_map_restParameter()));
    return seen.join(" ");
}
function meddle_map_restParameter(): void { map_restParameter.forEach((...all: any[]) => { alter(all[2]); return all[0]; }); }
const set_restParameter: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_restParameter(): number { let t = 0; for (const k of set_restParameter) t += k.length; return t; }
function eachOf_set_restParameter(): number { let t = 0; set_restParameter.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_restParameter(): string {
    const seen: string[] = [];
    seen.push(show(set_restParameter.has("zz")));
    seen.push(show(set_restParameter.size));
    seen.push(show([...set_restParameter]));
    seen.push(show(sumOf_set_restParameter()));
    seen.push(show(eachOf_set_restParameter()));
    return seen.join(" ");
}
function meddle_set_restParameter(): void { set_restParameter.forEach((...all: any[]) => { alter(all[2]); return all[0]; }); }
const array_restBehindTwo: number[] = [3, 1, 2];
function sumOf_array_restBehindTwo(): number { let t = 0; for (const x of array_restBehindTwo) t += x; return t; }
function eachOf_array_restBehindTwo(): number { let t = 0; array_restBehindTwo.forEach((x: number) => { t += x; }); return t; }
function plain_array_restBehindTwo(): string {
    const seen: string[] = [];
    seen.push(show(array_restBehindTwo.map((x: number) => x * 2)));
    seen.push(show(array_restBehindTwo.includes(99)));
    seen.push(show(array_restBehindTwo.join("-")));
    seen.push(show(array_restBehindTwo.some((x: number) => x > 50)));
    seen.push(show(array_restBehindTwo.length));
    seen.push(show([...array_restBehindTwo]));
    seen.push(show(sumOf_array_restBehindTwo()));
    seen.push(show(eachOf_array_restBehindTwo()));
    seen.push(show(array_restBehindTwo.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_restBehindTwo(): void { array_restBehindTwo.map((a: any, b: any, ...more: any[]) => { alter(more[0]); return a; }); }
const map_restBehindTwo: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_restBehindTwo(): number { let t = 0; for (const [k, v] of map_restBehindTwo) t += v + k.length; return t; }
function eachOf_map_restBehindTwo(): number { let t = 0; map_restBehindTwo.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_restBehindTwo(): string {
    const seen: string[] = [];
    seen.push(show(map_restBehindTwo.get("a")));
    seen.push(show(map_restBehindTwo.has("zz")));
    seen.push(show(map_restBehindTwo.size));
    seen.push(show([...map_restBehindTwo.keys()]));
    seen.push(show(sumOf_map_restBehindTwo()));
    seen.push(show(eachOf_map_restBehindTwo()));
    return seen.join(" ");
}
function meddle_map_restBehindTwo(): void { map_restBehindTwo.forEach((a: any, b: any, ...more: any[]) => { alter(more[0]); return a; }); }
const set_restBehindTwo: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_restBehindTwo(): number { let t = 0; for (const k of set_restBehindTwo) t += k.length; return t; }
function eachOf_set_restBehindTwo(): number { let t = 0; set_restBehindTwo.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_restBehindTwo(): string {
    const seen: string[] = [];
    seen.push(show(set_restBehindTwo.has("zz")));
    seen.push(show(set_restBehindTwo.size));
    seen.push(show([...set_restBehindTwo]));
    seen.push(show(sumOf_set_restBehindTwo()));
    seen.push(show(eachOf_set_restBehindTwo()));
    return seen.join(" ");
}
function meddle_set_restBehindTwo(): void { set_restBehindTwo.forEach((a: any, b: any, ...more: any[]) => { alter(more[0]); return a; }); }
const array_restSpreadOn: number[] = [3, 1, 2];
function sumOf_array_restSpreadOn(): number { let t = 0; for (const x of array_restSpreadOn) t += x; return t; }
function eachOf_array_restSpreadOn(): number { let t = 0; array_restSpreadOn.forEach((x: number) => { t += x; }); return t; }
function plain_array_restSpreadOn(): string {
    const seen: string[] = [];
    seen.push(show(array_restSpreadOn.map((x: number) => x * 2)));
    seen.push(show(array_restSpreadOn.includes(99)));
    seen.push(show(array_restSpreadOn.join("-")));
    seen.push(show(array_restSpreadOn.some((x: number) => x > 50)));
    seen.push(show(array_restSpreadOn.length));
    seen.push(show([...array_restSpreadOn]));
    seen.push(show(sumOf_array_restSpreadOn()));
    seen.push(show(eachOf_array_restSpreadOn()));
    seen.push(show(array_restSpreadOn.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_restSpreadOn(): void { const third = (a: any, b: any, c: any): void => { alter(c); }; array_restSpreadOn.map((...all: any[]) => { third(...(all as [any, any, any])); return all[0]; }); }
const map_restSpreadOn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_restSpreadOn(): number { let t = 0; for (const [k, v] of map_restSpreadOn) t += v + k.length; return t; }
function eachOf_map_restSpreadOn(): number { let t = 0; map_restSpreadOn.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_restSpreadOn(): string {
    const seen: string[] = [];
    seen.push(show(map_restSpreadOn.get("a")));
    seen.push(show(map_restSpreadOn.has("zz")));
    seen.push(show(map_restSpreadOn.size));
    seen.push(show([...map_restSpreadOn.keys()]));
    seen.push(show(sumOf_map_restSpreadOn()));
    seen.push(show(eachOf_map_restSpreadOn()));
    return seen.join(" ");
}
function meddle_map_restSpreadOn(): void { const third = (a: any, b: any, c: any): void => { alter(c); }; map_restSpreadOn.forEach((...all: any[]) => { third(...(all as [any, any, any])); return all[0]; }); }
const set_restSpreadOn: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_restSpreadOn(): number { let t = 0; for (const k of set_restSpreadOn) t += k.length; return t; }
function eachOf_set_restSpreadOn(): number { let t = 0; set_restSpreadOn.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_restSpreadOn(): string {
    const seen: string[] = [];
    seen.push(show(set_restSpreadOn.has("zz")));
    seen.push(show(set_restSpreadOn.size));
    seen.push(show([...set_restSpreadOn]));
    seen.push(show(sumOf_set_restSpreadOn()));
    seen.push(show(eachOf_set_restSpreadOn()));
    return seen.join(" ");
}
function meddle_set_restSpreadOn(): void { const third = (a: any, b: any, c: any): void => { alter(c); }; set_restSpreadOn.forEach((...all: any[]) => { third(...(all as [any, any, any])); return all[0]; }); }
const array_restLengthAndLast: number[] = [3, 1, 2];
function sumOf_array_restLengthAndLast(): number { let t = 0; for (const x of array_restLengthAndLast) t += x; return t; }
function eachOf_array_restLengthAndLast(): number { let t = 0; array_restLengthAndLast.forEach((x: number) => { t += x; }); return t; }
function plain_array_restLengthAndLast(): string {
    const seen: string[] = [];
    seen.push(show(array_restLengthAndLast.map((x: number) => x * 2)));
    seen.push(show(array_restLengthAndLast.includes(99)));
    seen.push(show(array_restLengthAndLast.join("-")));
    seen.push(show(array_restLengthAndLast.some((x: number) => x > 50)));
    seen.push(show(array_restLengthAndLast.length));
    seen.push(show([...array_restLengthAndLast]));
    seen.push(show(sumOf_array_restLengthAndLast()));
    seen.push(show(eachOf_array_restLengthAndLast()));
    seen.push(show(array_restLengthAndLast.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_restLengthAndLast(): void { array_restLengthAndLast.map((...all: any[]) => { alter(all[all.length - 1]); return all[0]; }); }
const map_restLengthAndLast: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_restLengthAndLast(): number { let t = 0; for (const [k, v] of map_restLengthAndLast) t += v + k.length; return t; }
function eachOf_map_restLengthAndLast(): number { let t = 0; map_restLengthAndLast.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_restLengthAndLast(): string {
    const seen: string[] = [];
    seen.push(show(map_restLengthAndLast.get("a")));
    seen.push(show(map_restLengthAndLast.has("zz")));
    seen.push(show(map_restLengthAndLast.size));
    seen.push(show([...map_restLengthAndLast.keys()]));
    seen.push(show(sumOf_map_restLengthAndLast()));
    seen.push(show(eachOf_map_restLengthAndLast()));
    return seen.join(" ");
}
function meddle_map_restLengthAndLast(): void { map_restLengthAndLast.forEach((...all: any[]) => { alter(all[all.length - 1]); return all[0]; }); }
const set_restLengthAndLast: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_restLengthAndLast(): number { let t = 0; for (const k of set_restLengthAndLast) t += k.length; return t; }
function eachOf_set_restLengthAndLast(): number { let t = 0; set_restLengthAndLast.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_restLengthAndLast(): string {
    const seen: string[] = [];
    seen.push(show(set_restLengthAndLast.has("zz")));
    seen.push(show(set_restLengthAndLast.size));
    seen.push(show([...set_restLengthAndLast]));
    seen.push(show(sumOf_set_restLengthAndLast()));
    seen.push(show(eachOf_set_restLengthAndLast()));
    return seen.join(" ");
}
function meddle_set_restLengthAndLast(): void { set_restLengthAndLast.forEach((...all: any[]) => { alter(all[all.length - 1]); return all[0]; }); }
const array_defaultFromArguments: number[] = [3, 1, 2];
function sumOf_array_defaultFromArguments(): number { let t = 0; for (const x of array_defaultFromArguments) t += x; return t; }
function eachOf_array_defaultFromArguments(): number { let t = 0; array_defaultFromArguments.forEach((x: number) => { t += x; }); return t; }
function plain_array_defaultFromArguments(): string {
    const seen: string[] = [];
    seen.push(show(array_defaultFromArguments.map((x: number) => x * 2)));
    seen.push(show(array_defaultFromArguments.includes(99)));
    seen.push(show(array_defaultFromArguments.join("-")));
    seen.push(show(array_defaultFromArguments.some((x: number) => x > 50)));
    seen.push(show(array_defaultFromArguments.length));
    seen.push(show([...array_defaultFromArguments]));
    seen.push(show(sumOf_array_defaultFromArguments()));
    seen.push(show(eachOf_array_defaultFromArguments()));
    seen.push(show(array_defaultFromArguments.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_defaultFromArguments(): void { array_defaultFromArguments.map(function (a: any, b: any = arguments[2]): any { alter(arguments[2]); return a; }); }
const map_defaultFromArguments: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_defaultFromArguments(): number { let t = 0; for (const [k, v] of map_defaultFromArguments) t += v + k.length; return t; }
function eachOf_map_defaultFromArguments(): number { let t = 0; map_defaultFromArguments.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_defaultFromArguments(): string {
    const seen: string[] = [];
    seen.push(show(map_defaultFromArguments.get("a")));
    seen.push(show(map_defaultFromArguments.has("zz")));
    seen.push(show(map_defaultFromArguments.size));
    seen.push(show([...map_defaultFromArguments.keys()]));
    seen.push(show(sumOf_map_defaultFromArguments()));
    seen.push(show(eachOf_map_defaultFromArguments()));
    return seen.join(" ");
}
function meddle_map_defaultFromArguments(): void { map_defaultFromArguments.forEach(function (a: any, b: any = arguments[2]): any { alter(arguments[2]); return a; }); }
const set_defaultFromArguments: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_defaultFromArguments(): number { let t = 0; for (const k of set_defaultFromArguments) t += k.length; return t; }
function eachOf_set_defaultFromArguments(): number { let t = 0; set_defaultFromArguments.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_defaultFromArguments(): string {
    const seen: string[] = [];
    seen.push(show(set_defaultFromArguments.has("zz")));
    seen.push(show(set_defaultFromArguments.size));
    seen.push(show([...set_defaultFromArguments]));
    seen.push(show(sumOf_set_defaultFromArguments()));
    seen.push(show(eachOf_set_defaultFromArguments()));
    return seen.join(" ");
}
function meddle_set_defaultFromArguments(): void { set_defaultFromArguments.forEach(function (a: any, b: any = arguments[2]): any { alter(arguments[2]); return a; }); }
const array_restBehindOne: number[] = [3, 1, 2];
function sumOf_array_restBehindOne(): number { let t = 0; for (const x of array_restBehindOne) t += x; return t; }
function eachOf_array_restBehindOne(): number { let t = 0; array_restBehindOne.forEach((x: number) => { t += x; }); return t; }
function plain_array_restBehindOne(): string {
    const seen: string[] = [];
    seen.push(show(array_restBehindOne.map((x: number) => x * 2)));
    seen.push(show(array_restBehindOne.includes(99)));
    seen.push(show(array_restBehindOne.join("-")));
    seen.push(show(array_restBehindOne.some((x: number) => x > 50)));
    seen.push(show(array_restBehindOne.length));
    seen.push(show([...array_restBehindOne]));
    seen.push(show(sumOf_array_restBehindOne()));
    seen.push(show(eachOf_array_restBehindOne()));
    seen.push(show(array_restBehindOne.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_restBehindOne(): void { array_restBehindOne.map((a: any, ...more: any[]) => { alter(more[1]); return a; }); }
const map_restBehindOne: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_restBehindOne(): number { let t = 0; for (const [k, v] of map_restBehindOne) t += v + k.length; return t; }
function eachOf_map_restBehindOne(): number { let t = 0; map_restBehindOne.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_restBehindOne(): string {
    const seen: string[] = [];
    seen.push(show(map_restBehindOne.get("a")));
    seen.push(show(map_restBehindOne.has("zz")));
    seen.push(show(map_restBehindOne.size));
    seen.push(show([...map_restBehindOne.keys()]));
    seen.push(show(sumOf_map_restBehindOne()));
    seen.push(show(eachOf_map_restBehindOne()));
    return seen.join(" ");
}
function meddle_map_restBehindOne(): void { map_restBehindOne.forEach((a: any, ...more: any[]) => { alter(more[1]); return a; }); }
const set_restBehindOne: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_restBehindOne(): number { let t = 0; for (const k of set_restBehindOne) t += k.length; return t; }
function eachOf_set_restBehindOne(): number { let t = 0; set_restBehindOne.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_restBehindOne(): string {
    const seen: string[] = [];
    seen.push(show(set_restBehindOne.has("zz")));
    seen.push(show(set_restBehindOne.size));
    seen.push(show([...set_restBehindOne]));
    seen.push(show(sumOf_set_restBehindOne()));
    seen.push(show(eachOf_set_restBehindOne()));
    return seen.join(" ");
}
function meddle_set_restBehindOne(): void { set_restBehindOne.forEach((a: any, ...more: any[]) => { alter(more[1]); return a; }); }
const array_callbackNotKnown: number[] = [3, 1, 2];
function sumOf_array_callbackNotKnown(): number { let t = 0; for (const x of array_callbackNotKnown) t += x; return t; }
function eachOf_array_callbackNotKnown(): number { let t = 0; array_callbackNotKnown.forEach((x: number) => { t += x; }); return t; }
function run_array_callbackNotKnown(f: any): void { array_callbackNotKnown.map(f); }
function plain_array_callbackNotKnown(): string {
    const seen: string[] = [];
    seen.push(show(array_callbackNotKnown.map((x: number) => x * 2)));
    seen.push(show(array_callbackNotKnown.includes(99)));
    seen.push(show(array_callbackNotKnown.join("-")));
    seen.push(show(array_callbackNotKnown.some((x: number) => x > 50)));
    seen.push(show(array_callbackNotKnown.length));
    seen.push(show([...array_callbackNotKnown]));
    seen.push(show(sumOf_array_callbackNotKnown()));
    seen.push(show(eachOf_array_callbackNotKnown()));
    seen.push(show(array_callbackNotKnown.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_callbackNotKnown(): void { run_array_callbackNotKnown((a: any, b: any, c: any) => { alter(c); return a; }); }
const map_callbackNotKnown: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_callbackNotKnown(): number { let t = 0; for (const [k, v] of map_callbackNotKnown) t += v + k.length; return t; }
function eachOf_map_callbackNotKnown(): number { let t = 0; map_callbackNotKnown.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function run_map_callbackNotKnown(f: any): void { map_callbackNotKnown.forEach(f); }
function plain_map_callbackNotKnown(): string {
    const seen: string[] = [];
    seen.push(show(map_callbackNotKnown.get("a")));
    seen.push(show(map_callbackNotKnown.has("zz")));
    seen.push(show(map_callbackNotKnown.size));
    seen.push(show([...map_callbackNotKnown.keys()]));
    seen.push(show(sumOf_map_callbackNotKnown()));
    seen.push(show(eachOf_map_callbackNotKnown()));
    return seen.join(" ");
}
function meddle_map_callbackNotKnown(): void { run_map_callbackNotKnown((a: any, b: any, c: any) => { alter(c); return a; }); }
const set_callbackNotKnown: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_callbackNotKnown(): number { let t = 0; for (const k of set_callbackNotKnown) t += k.length; return t; }
function eachOf_set_callbackNotKnown(): number { let t = 0; set_callbackNotKnown.forEach((k: string) => { t += k.length; }); return t; }
function run_set_callbackNotKnown(f: any): void { set_callbackNotKnown.forEach(f); }
function plain_set_callbackNotKnown(): string {
    const seen: string[] = [];
    seen.push(show(set_callbackNotKnown.has("zz")));
    seen.push(show(set_callbackNotKnown.size));
    seen.push(show([...set_callbackNotKnown]));
    seen.push(show(sumOf_set_callbackNotKnown()));
    seen.push(show(eachOf_set_callbackNotKnown()));
    return seen.join(" ");
}
function meddle_set_callbackNotKnown(): void { run_set_callbackNotKnown((a: any, b: any, c: any) => { alter(c); return a; }); }
const array_callbackOutOfAField: number[] = [3, 1, 2];
function sumOf_array_callbackOutOfAField(): number { let t = 0; for (const x of array_callbackOutOfAField) t += x; return t; }
function eachOf_array_callbackOutOfAField(): number { let t = 0; array_callbackOutOfAField.forEach((x: number) => { t += x; }); return t; }
function plain_array_callbackOutOfAField(): string {
    const seen: string[] = [];
    seen.push(show(array_callbackOutOfAField.map((x: number) => x * 2)));
    seen.push(show(array_callbackOutOfAField.includes(99)));
    seen.push(show(array_callbackOutOfAField.join("-")));
    seen.push(show(array_callbackOutOfAField.some((x: number) => x > 50)));
    seen.push(show(array_callbackOutOfAField.length));
    seen.push(show([...array_callbackOutOfAField]));
    seen.push(show(sumOf_array_callbackOutOfAField()));
    seen.push(show(eachOf_array_callbackOutOfAField()));
    seen.push(show(array_callbackOutOfAField.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_callbackOutOfAField(): void { holder.it = (a: any, b: any, c: any) => { alter(c); return a; }; array_callbackOutOfAField.map(holder.it); }
const map_callbackOutOfAField: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_callbackOutOfAField(): number { let t = 0; for (const [k, v] of map_callbackOutOfAField) t += v + k.length; return t; }
function eachOf_map_callbackOutOfAField(): number { let t = 0; map_callbackOutOfAField.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_callbackOutOfAField(): string {
    const seen: string[] = [];
    seen.push(show(map_callbackOutOfAField.get("a")));
    seen.push(show(map_callbackOutOfAField.has("zz")));
    seen.push(show(map_callbackOutOfAField.size));
    seen.push(show([...map_callbackOutOfAField.keys()]));
    seen.push(show(sumOf_map_callbackOutOfAField()));
    seen.push(show(eachOf_map_callbackOutOfAField()));
    return seen.join(" ");
}
function meddle_map_callbackOutOfAField(): void { holder.it = (a: any, b: any, c: any) => { alter(c); return a; }; map_callbackOutOfAField.forEach(holder.it); }
const set_callbackOutOfAField: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_callbackOutOfAField(): number { let t = 0; for (const k of set_callbackOutOfAField) t += k.length; return t; }
function eachOf_set_callbackOutOfAField(): number { let t = 0; set_callbackOutOfAField.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_callbackOutOfAField(): string {
    const seen: string[] = [];
    seen.push(show(set_callbackOutOfAField.has("zz")));
    seen.push(show(set_callbackOutOfAField.size));
    seen.push(show([...set_callbackOutOfAField]));
    seen.push(show(sumOf_set_callbackOutOfAField()));
    seen.push(show(eachOf_set_callbackOutOfAField()));
    return seen.join(" ");
}
function meddle_set_callbackOutOfAField(): void { holder.it = (a: any, b: any, c: any) => { alter(c); return a; }; set_callbackOutOfAField.forEach(holder.it); }
const array_callbackOneOfTwo: number[] = [3, 1, 2];
function sumOf_array_callbackOneOfTwo(): number { let t = 0; for (const x of array_callbackOneOfTwo) t += x; return t; }
function eachOf_array_callbackOneOfTwo(): number { let t = 0; array_callbackOneOfTwo.forEach((x: number) => { t += x; }); return t; }
function plain_array_callbackOneOfTwo(): string {
    const seen: string[] = [];
    seen.push(show(array_callbackOneOfTwo.map((x: number) => x * 2)));
    seen.push(show(array_callbackOneOfTwo.includes(99)));
    seen.push(show(array_callbackOneOfTwo.join("-")));
    seen.push(show(array_callbackOneOfTwo.some((x: number) => x > 50)));
    seen.push(show(array_callbackOneOfTwo.length));
    seen.push(show([...array_callbackOneOfTwo]));
    seen.push(show(sumOf_array_callbackOneOfTwo()));
    seen.push(show(eachOf_array_callbackOneOfTwo()));
    seen.push(show(array_callbackOneOfTwo.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_callbackOneOfTwo(): void { const f = yes ? (a: any, b: any, c: any) => { alter(c); return a; } : (a: any) => a; array_callbackOneOfTwo.map(f); }
const map_callbackOneOfTwo: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_callbackOneOfTwo(): number { let t = 0; for (const [k, v] of map_callbackOneOfTwo) t += v + k.length; return t; }
function eachOf_map_callbackOneOfTwo(): number { let t = 0; map_callbackOneOfTwo.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_callbackOneOfTwo(): string {
    const seen: string[] = [];
    seen.push(show(map_callbackOneOfTwo.get("a")));
    seen.push(show(map_callbackOneOfTwo.has("zz")));
    seen.push(show(map_callbackOneOfTwo.size));
    seen.push(show([...map_callbackOneOfTwo.keys()]));
    seen.push(show(sumOf_map_callbackOneOfTwo()));
    seen.push(show(eachOf_map_callbackOneOfTwo()));
    return seen.join(" ");
}
function meddle_map_callbackOneOfTwo(): void { const f = yes ? (a: any, b: any, c: any) => { alter(c); return a; } : (a: any) => a; map_callbackOneOfTwo.forEach(f); }
const set_callbackOneOfTwo: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_callbackOneOfTwo(): number { let t = 0; for (const k of set_callbackOneOfTwo) t += k.length; return t; }
function eachOf_set_callbackOneOfTwo(): number { let t = 0; set_callbackOneOfTwo.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_callbackOneOfTwo(): string {
    const seen: string[] = [];
    seen.push(show(set_callbackOneOfTwo.has("zz")));
    seen.push(show(set_callbackOneOfTwo.size));
    seen.push(show([...set_callbackOneOfTwo]));
    seen.push(show(sumOf_set_callbackOneOfTwo()));
    seen.push(show(eachOf_set_callbackOneOfTwo()));
    return seen.join(" ");
}
function meddle_set_callbackOneOfTwo(): void { const f = yes ? (a: any, b: any, c: any) => { alter(c); return a; } : (a: any) => a; set_callbackOneOfTwo.forEach(f); }
const array_callbackBound: number[] = [3, 1, 2];
function sumOf_array_callbackBound(): number { let t = 0; for (const x of array_callbackBound) t += x; return t; }
function eachOf_array_callbackBound(): number { let t = 0; array_callbackBound.forEach((x: number) => { t += x; }); return t; }
function plain_array_callbackBound(): string {
    const seen: string[] = [];
    seen.push(show(array_callbackBound.map((x: number) => x * 2)));
    seen.push(show(array_callbackBound.includes(99)));
    seen.push(show(array_callbackBound.join("-")));
    seen.push(show(array_callbackBound.some((x: number) => x > 50)));
    seen.push(show(array_callbackBound.length));
    seen.push(show([...array_callbackBound]));
    seen.push(show(sumOf_array_callbackBound()));
    seen.push(show(eachOf_array_callbackBound()));
    seen.push(show(array_callbackBound.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_callbackBound(): void { array_callbackBound.map(alterFirst.bind(undefined, array_callbackBound)); }
const map_callbackBound: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_callbackBound(): number { let t = 0; for (const [k, v] of map_callbackBound) t += v + k.length; return t; }
function eachOf_map_callbackBound(): number { let t = 0; map_callbackBound.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_callbackBound(): string {
    const seen: string[] = [];
    seen.push(show(map_callbackBound.get("a")));
    seen.push(show(map_callbackBound.has("zz")));
    seen.push(show(map_callbackBound.size));
    seen.push(show([...map_callbackBound.keys()]));
    seen.push(show(sumOf_map_callbackBound()));
    seen.push(show(eachOf_map_callbackBound()));
    return seen.join(" ");
}
function meddle_map_callbackBound(): void { map_callbackBound.forEach(alterFirst.bind(undefined, map_callbackBound)); }
const set_callbackBound: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_callbackBound(): number { let t = 0; for (const k of set_callbackBound) t += k.length; return t; }
function eachOf_set_callbackBound(): number { let t = 0; set_callbackBound.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_callbackBound(): string {
    const seen: string[] = [];
    seen.push(show(set_callbackBound.has("zz")));
    seen.push(show(set_callbackBound.size));
    seen.push(show([...set_callbackBound]));
    seen.push(show(sumOf_set_callbackBound()));
    seen.push(show(eachOf_set_callbackBound()));
    return seen.join(" ");
}
function meddle_set_callbackBound(): void { set_callbackBound.forEach(alterFirst.bind(undefined, set_callbackBound)); }
const array_thisArgument: number[] = [3, 1, 2];
function sumOf_array_thisArgument(): number { let t = 0; for (const x of array_thisArgument) t += x; return t; }
function eachOf_array_thisArgument(): number { let t = 0; array_thisArgument.forEach((x: number) => { t += x; }); return t; }
function plain_array_thisArgument(): string {
    const seen: string[] = [];
    seen.push(show(array_thisArgument.map((x: number) => x * 2)));
    seen.push(show(array_thisArgument.includes(99)));
    seen.push(show(array_thisArgument.join("-")));
    seen.push(show(array_thisArgument.some((x: number) => x > 50)));
    seen.push(show(array_thisArgument.length));
    seen.push(show([...array_thisArgument]));
    seen.push(show(sumOf_array_thisArgument()));
    seen.push(show(eachOf_array_thisArgument()));
    seen.push(show(array_thisArgument.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_thisArgument(): void { array_thisArgument.map(function (this: any, a: any): any { alter(this); return a; }, array_thisArgument); }
const map_thisArgument: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_thisArgument(): number { let t = 0; for (const [k, v] of map_thisArgument) t += v + k.length; return t; }
function eachOf_map_thisArgument(): number { let t = 0; map_thisArgument.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_thisArgument(): string {
    const seen: string[] = [];
    seen.push(show(map_thisArgument.get("a")));
    seen.push(show(map_thisArgument.has("zz")));
    seen.push(show(map_thisArgument.size));
    seen.push(show([...map_thisArgument.keys()]));
    seen.push(show(sumOf_map_thisArgument()));
    seen.push(show(eachOf_map_thisArgument()));
    return seen.join(" ");
}
function meddle_map_thisArgument(): void { map_thisArgument.forEach(function (this: any, a: any): any { alter(this); return a; }, map_thisArgument); }
const set_thisArgument: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_thisArgument(): number { let t = 0; for (const k of set_thisArgument) t += k.length; return t; }
function eachOf_set_thisArgument(): number { let t = 0; set_thisArgument.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_thisArgument(): string {
    const seen: string[] = [];
    seen.push(show(set_thisArgument.has("zz")));
    seen.push(show(set_thisArgument.size));
    seen.push(show([...set_thisArgument]));
    seen.push(show(sumOf_set_thisArgument()));
    seen.push(show(eachOf_set_thisArgument()));
    return seen.join(" ");
}
function meddle_set_thisArgument(): void { set_thisArgument.forEach(function (this: any, a: any): any { alter(this); return a; }, set_thisArgument); }
const array_setPrototypeOf: number[] = [3, 1, 2];
function sumOf_array_setPrototypeOf(): number { let t = 0; for (const x of array_setPrototypeOf) t += x; return t; }
function eachOf_array_setPrototypeOf(): number { let t = 0; array_setPrototypeOf.forEach((x: number) => { t += x; }); return t; }
function plain_array_setPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(array_setPrototypeOf.map((x: number) => x * 2)));
    seen.push(show(array_setPrototypeOf.includes(99)));
    seen.push(show(array_setPrototypeOf.join("-")));
    seen.push(show(array_setPrototypeOf.some((x: number) => x > 50)));
    seen.push(show(array_setPrototypeOf.length));
    seen.push(show([...array_setPrototypeOf]));
    seen.push(show(sumOf_array_setPrototypeOf()));
    seen.push(show(eachOf_array_setPrototypeOf()));
    seen.push(show(array_setPrototypeOf.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_setPrototypeOf(): void { Object.setPrototypeOf(array_setPrototypeOf, otherPrototypeOf(array_setPrototypeOf)); }
const map_setPrototypeOf: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_setPrototypeOf(): number { let t = 0; for (const [k, v] of map_setPrototypeOf) t += v + k.length; return t; }
function eachOf_map_setPrototypeOf(): number { let t = 0; map_setPrototypeOf.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_setPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(map_setPrototypeOf.get("a")));
    seen.push(show(map_setPrototypeOf.has("zz")));
    seen.push(show(map_setPrototypeOf.size));
    seen.push(show([...map_setPrototypeOf.keys()]));
    seen.push(show(sumOf_map_setPrototypeOf()));
    seen.push(show(eachOf_map_setPrototypeOf()));
    return seen.join(" ");
}
function meddle_map_setPrototypeOf(): void { Object.setPrototypeOf(map_setPrototypeOf, otherPrototypeOf(map_setPrototypeOf)); }
const set_setPrototypeOf: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_setPrototypeOf(): number { let t = 0; for (const k of set_setPrototypeOf) t += k.length; return t; }
function eachOf_set_setPrototypeOf(): number { let t = 0; set_setPrototypeOf.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_setPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(set_setPrototypeOf.has("zz")));
    seen.push(show(set_setPrototypeOf.size));
    seen.push(show([...set_setPrototypeOf]));
    seen.push(show(sumOf_set_setPrototypeOf()));
    seen.push(show(eachOf_set_setPrototypeOf()));
    return seen.join(" ");
}
function meddle_set_setPrototypeOf(): void { Object.setPrototypeOf(set_setPrototypeOf, otherPrototypeOf(set_setPrototypeOf)); }
const array_reflectSetPrototypeOf: number[] = [3, 1, 2];
function sumOf_array_reflectSetPrototypeOf(): number { let t = 0; for (const x of array_reflectSetPrototypeOf) t += x; return t; }
function eachOf_array_reflectSetPrototypeOf(): number { let t = 0; array_reflectSetPrototypeOf.forEach((x: number) => { t += x; }); return t; }
function plain_array_reflectSetPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(array_reflectSetPrototypeOf.map((x: number) => x * 2)));
    seen.push(show(array_reflectSetPrototypeOf.includes(99)));
    seen.push(show(array_reflectSetPrototypeOf.join("-")));
    seen.push(show(array_reflectSetPrototypeOf.some((x: number) => x > 50)));
    seen.push(show(array_reflectSetPrototypeOf.length));
    seen.push(show([...array_reflectSetPrototypeOf]));
    seen.push(show(sumOf_array_reflectSetPrototypeOf()));
    seen.push(show(eachOf_array_reflectSetPrototypeOf()));
    seen.push(show(array_reflectSetPrototypeOf.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_reflectSetPrototypeOf(): void { Reflect.setPrototypeOf(array_reflectSetPrototypeOf, otherPrototypeOf(array_reflectSetPrototypeOf)); }
const map_reflectSetPrototypeOf: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_reflectSetPrototypeOf(): number { let t = 0; for (const [k, v] of map_reflectSetPrototypeOf) t += v + k.length; return t; }
function eachOf_map_reflectSetPrototypeOf(): number { let t = 0; map_reflectSetPrototypeOf.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_reflectSetPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(map_reflectSetPrototypeOf.get("a")));
    seen.push(show(map_reflectSetPrototypeOf.has("zz")));
    seen.push(show(map_reflectSetPrototypeOf.size));
    seen.push(show([...map_reflectSetPrototypeOf.keys()]));
    seen.push(show(sumOf_map_reflectSetPrototypeOf()));
    seen.push(show(eachOf_map_reflectSetPrototypeOf()));
    return seen.join(" ");
}
function meddle_map_reflectSetPrototypeOf(): void { Reflect.setPrototypeOf(map_reflectSetPrototypeOf, otherPrototypeOf(map_reflectSetPrototypeOf)); }
const set_reflectSetPrototypeOf: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_reflectSetPrototypeOf(): number { let t = 0; for (const k of set_reflectSetPrototypeOf) t += k.length; return t; }
function eachOf_set_reflectSetPrototypeOf(): number { let t = 0; set_reflectSetPrototypeOf.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_reflectSetPrototypeOf(): string {
    const seen: string[] = [];
    seen.push(show(set_reflectSetPrototypeOf.has("zz")));
    seen.push(show(set_reflectSetPrototypeOf.size));
    seen.push(show([...set_reflectSetPrototypeOf]));
    seen.push(show(sumOf_set_reflectSetPrototypeOf()));
    seen.push(show(eachOf_set_reflectSetPrototypeOf()));
    return seen.join(" ");
}
function meddle_set_reflectSetPrototypeOf(): void { Reflect.setPrototypeOf(set_reflectSetPrototypeOf, otherPrototypeOf(set_reflectSetPrototypeOf)); }
const array_protoAssigned: number[] = [3, 1, 2];
function sumOf_array_protoAssigned(): number { let t = 0; for (const x of array_protoAssigned) t += x; return t; }
function eachOf_array_protoAssigned(): number { let t = 0; array_protoAssigned.forEach((x: number) => { t += x; }); return t; }
function plain_array_protoAssigned(): string {
    const seen: string[] = [];
    seen.push(show(array_protoAssigned.map((x: number) => x * 2)));
    seen.push(show(array_protoAssigned.includes(99)));
    seen.push(show(array_protoAssigned.join("-")));
    seen.push(show(array_protoAssigned.some((x: number) => x > 50)));
    seen.push(show(array_protoAssigned.length));
    seen.push(show([...array_protoAssigned]));
    seen.push(show(sumOf_array_protoAssigned()));
    seen.push(show(eachOf_array_protoAssigned()));
    seen.push(show(array_protoAssigned.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_protoAssigned(): void { (array_protoAssigned as any).__proto__ = otherPrototypeOf(array_protoAssigned); }
const map_protoAssigned: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_protoAssigned(): number { let t = 0; for (const [k, v] of map_protoAssigned) t += v + k.length; return t; }
function eachOf_map_protoAssigned(): number { let t = 0; map_protoAssigned.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_protoAssigned(): string {
    const seen: string[] = [];
    seen.push(show(map_protoAssigned.get("a")));
    seen.push(show(map_protoAssigned.has("zz")));
    seen.push(show(map_protoAssigned.size));
    seen.push(show([...map_protoAssigned.keys()]));
    seen.push(show(sumOf_map_protoAssigned()));
    seen.push(show(eachOf_map_protoAssigned()));
    return seen.join(" ");
}
function meddle_map_protoAssigned(): void { (map_protoAssigned as any).__proto__ = otherPrototypeOf(map_protoAssigned); }
const set_protoAssigned: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_protoAssigned(): number { let t = 0; for (const k of set_protoAssigned) t += k.length; return t; }
function eachOf_set_protoAssigned(): number { let t = 0; set_protoAssigned.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_protoAssigned(): string {
    const seen: string[] = [];
    seen.push(show(set_protoAssigned.has("zz")));
    seen.push(show(set_protoAssigned.size));
    seen.push(show([...set_protoAssigned]));
    seen.push(show(sumOf_set_protoAssigned()));
    seen.push(show(eachOf_set_protoAssigned()));
    return seen.join(" ");
}
function meddle_set_protoAssigned(): void { (set_protoAssigned as any).__proto__ = otherPrototypeOf(set_protoAssigned); }
const array_defineProperty: number[] = [3, 1, 2];
function sumOf_array_defineProperty(): number { let t = 0; for (const x of array_defineProperty) t += x; return t; }
function eachOf_array_defineProperty(): number { let t = 0; array_defineProperty.forEach((x: number) => { t += x; }); return t; }
function plain_array_defineProperty(): string {
    const seen: string[] = [];
    seen.push(show(array_defineProperty.map((x: number) => x * 2)));
    seen.push(show(array_defineProperty.includes(99)));
    seen.push(show(array_defineProperty.join("-")));
    seen.push(show(array_defineProperty.some((x: number) => x > 50)));
    seen.push(show(array_defineProperty.length));
    seen.push(show([...array_defineProperty]));
    seen.push(show(sumOf_array_defineProperty()));
    seen.push(show(eachOf_array_defineProperty()));
    seen.push(show(array_defineProperty.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_defineProperty(): void { Object.defineProperty(array_defineProperty, "map", { get() { marks++; return () => [-41]; }, configurable: true }); }
const map_defineProperty: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_defineProperty(): number { let t = 0; for (const [k, v] of map_defineProperty) t += v + k.length; return t; }
function eachOf_map_defineProperty(): number { let t = 0; map_defineProperty.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_defineProperty(): string {
    const seen: string[] = [];
    seen.push(show(map_defineProperty.get("a")));
    seen.push(show(map_defineProperty.has("zz")));
    seen.push(show(map_defineProperty.size));
    seen.push(show([...map_defineProperty.keys()]));
    seen.push(show(sumOf_map_defineProperty()));
    seen.push(show(eachOf_map_defineProperty()));
    return seen.join(" ");
}
function meddle_map_defineProperty(): void { Object.defineProperty(map_defineProperty, "get", { get() { marks++; return () => -41; }, configurable: true }); }
const set_defineProperty: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_defineProperty(): number { let t = 0; for (const k of set_defineProperty) t += k.length; return t; }
function eachOf_set_defineProperty(): number { let t = 0; set_defineProperty.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_defineProperty(): string {
    const seen: string[] = [];
    seen.push(show(set_defineProperty.has("zz")));
    seen.push(show(set_defineProperty.size));
    seen.push(show([...set_defineProperty]));
    seen.push(show(sumOf_set_defineProperty()));
    seen.push(show(eachOf_set_defineProperty()));
    return seen.join(" ");
}
function meddle_set_defineProperty(): void { Object.defineProperty(set_defineProperty, "has", { get() { marks++; return () => true; }, configurable: true }); }
const array_defineProperties: number[] = [3, 1, 2];
function sumOf_array_defineProperties(): number { let t = 0; for (const x of array_defineProperties) t += x; return t; }
function eachOf_array_defineProperties(): number { let t = 0; array_defineProperties.forEach((x: number) => { t += x; }); return t; }
function plain_array_defineProperties(): string {
    const seen: string[] = [];
    seen.push(show(array_defineProperties.map((x: number) => x * 2)));
    seen.push(show(array_defineProperties.includes(99)));
    seen.push(show(array_defineProperties.join("-")));
    seen.push(show(array_defineProperties.some((x: number) => x > 50)));
    seen.push(show(array_defineProperties.length));
    seen.push(show([...array_defineProperties]));
    seen.push(show(sumOf_array_defineProperties()));
    seen.push(show(eachOf_array_defineProperties()));
    seen.push(show(array_defineProperties.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_defineProperties(): void { Object.defineProperties(array_defineProperties, { map: { value: () => [-41], configurable: true } }); }
const map_defineProperties: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_defineProperties(): number { let t = 0; for (const [k, v] of map_defineProperties) t += v + k.length; return t; }
function eachOf_map_defineProperties(): number { let t = 0; map_defineProperties.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_defineProperties(): string {
    const seen: string[] = [];
    seen.push(show(map_defineProperties.get("a")));
    seen.push(show(map_defineProperties.has("zz")));
    seen.push(show(map_defineProperties.size));
    seen.push(show([...map_defineProperties.keys()]));
    seen.push(show(sumOf_map_defineProperties()));
    seen.push(show(eachOf_map_defineProperties()));
    return seen.join(" ");
}
function meddle_map_defineProperties(): void { Object.defineProperties(map_defineProperties, { get: { value: () => -41, configurable: true } }); }
const set_defineProperties: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_defineProperties(): number { let t = 0; for (const k of set_defineProperties) t += k.length; return t; }
function eachOf_set_defineProperties(): number { let t = 0; set_defineProperties.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_defineProperties(): string {
    const seen: string[] = [];
    seen.push(show(set_defineProperties.has("zz")));
    seen.push(show(set_defineProperties.size));
    seen.push(show([...set_defineProperties]));
    seen.push(show(sumOf_set_defineProperties()));
    seen.push(show(eachOf_set_defineProperties()));
    return seen.join(" ");
}
function meddle_set_defineProperties(): void { Object.defineProperties(set_defineProperties, { has: { value: () => true, configurable: true } }); }
const array_reflectDefineProperty: number[] = [3, 1, 2];
function sumOf_array_reflectDefineProperty(): number { let t = 0; for (const x of array_reflectDefineProperty) t += x; return t; }
function eachOf_array_reflectDefineProperty(): number { let t = 0; array_reflectDefineProperty.forEach((x: number) => { t += x; }); return t; }
function plain_array_reflectDefineProperty(): string {
    const seen: string[] = [];
    seen.push(show(array_reflectDefineProperty.map((x: number) => x * 2)));
    seen.push(show(array_reflectDefineProperty.includes(99)));
    seen.push(show(array_reflectDefineProperty.join("-")));
    seen.push(show(array_reflectDefineProperty.some((x: number) => x > 50)));
    seen.push(show(array_reflectDefineProperty.length));
    seen.push(show([...array_reflectDefineProperty]));
    seen.push(show(sumOf_array_reflectDefineProperty()));
    seen.push(show(eachOf_array_reflectDefineProperty()));
    seen.push(show(array_reflectDefineProperty.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_reflectDefineProperty(): void { Reflect.defineProperty(array_reflectDefineProperty, "map", { value: () => [-41], configurable: true }); }
const map_reflectDefineProperty: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_reflectDefineProperty(): number { let t = 0; for (const [k, v] of map_reflectDefineProperty) t += v + k.length; return t; }
function eachOf_map_reflectDefineProperty(): number { let t = 0; map_reflectDefineProperty.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_reflectDefineProperty(): string {
    const seen: string[] = [];
    seen.push(show(map_reflectDefineProperty.get("a")));
    seen.push(show(map_reflectDefineProperty.has("zz")));
    seen.push(show(map_reflectDefineProperty.size));
    seen.push(show([...map_reflectDefineProperty.keys()]));
    seen.push(show(sumOf_map_reflectDefineProperty()));
    seen.push(show(eachOf_map_reflectDefineProperty()));
    return seen.join(" ");
}
function meddle_map_reflectDefineProperty(): void { Reflect.defineProperty(map_reflectDefineProperty, "get", { value: () => -41, configurable: true }); }
const set_reflectDefineProperty: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_reflectDefineProperty(): number { let t = 0; for (const k of set_reflectDefineProperty) t += k.length; return t; }
function eachOf_set_reflectDefineProperty(): number { let t = 0; set_reflectDefineProperty.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_reflectDefineProperty(): string {
    const seen: string[] = [];
    seen.push(show(set_reflectDefineProperty.has("zz")));
    seen.push(show(set_reflectDefineProperty.size));
    seen.push(show([...set_reflectDefineProperty]));
    seen.push(show(sumOf_set_reflectDefineProperty()));
    seen.push(show(eachOf_set_reflectDefineProperty()));
    return seen.join(" ");
}
function meddle_set_reflectDefineProperty(): void { Reflect.defineProperty(set_reflectDefineProperty, "has", { value: () => true, configurable: true }); }
const array_reflectSet: number[] = [3, 1, 2];
function sumOf_array_reflectSet(): number { let t = 0; for (const x of array_reflectSet) t += x; return t; }
function eachOf_array_reflectSet(): number { let t = 0; array_reflectSet.forEach((x: number) => { t += x; }); return t; }
function plain_array_reflectSet(): string {
    const seen: string[] = [];
    seen.push(show(array_reflectSet.map((x: number) => x * 2)));
    seen.push(show(array_reflectSet.includes(99)));
    seen.push(show(array_reflectSet.join("-")));
    seen.push(show(array_reflectSet.some((x: number) => x > 50)));
    seen.push(show(array_reflectSet.length));
    seen.push(show([...array_reflectSet]));
    seen.push(show(sumOf_array_reflectSet()));
    seen.push(show(eachOf_array_reflectSet()));
    seen.push(show(array_reflectSet.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_reflectSet(): void { Reflect.set(array_reflectSet, "map", () => [-41]); }
const map_reflectSet: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_reflectSet(): number { let t = 0; for (const [k, v] of map_reflectSet) t += v + k.length; return t; }
function eachOf_map_reflectSet(): number { let t = 0; map_reflectSet.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_reflectSet(): string {
    const seen: string[] = [];
    seen.push(show(map_reflectSet.get("a")));
    seen.push(show(map_reflectSet.has("zz")));
    seen.push(show(map_reflectSet.size));
    seen.push(show([...map_reflectSet.keys()]));
    seen.push(show(sumOf_map_reflectSet()));
    seen.push(show(eachOf_map_reflectSet()));
    return seen.join(" ");
}
function meddle_map_reflectSet(): void { Reflect.set(map_reflectSet, "get", () => -41); }
const set_reflectSet: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_reflectSet(): number { let t = 0; for (const k of set_reflectSet) t += k.length; return t; }
function eachOf_set_reflectSet(): number { let t = 0; set_reflectSet.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_reflectSet(): string {
    const seen: string[] = [];
    seen.push(show(set_reflectSet.has("zz")));
    seen.push(show(set_reflectSet.size));
    seen.push(show([...set_reflectSet]));
    seen.push(show(sumOf_set_reflectSet()));
    seen.push(show(eachOf_set_reflectSet()));
    return seen.join(" ");
}
function meddle_set_reflectSet(): void { Reflect.set(set_reflectSet, "has", () => true); }
const array_objectAssign: number[] = [3, 1, 2];
function sumOf_array_objectAssign(): number { let t = 0; for (const x of array_objectAssign) t += x; return t; }
function eachOf_array_objectAssign(): number { let t = 0; array_objectAssign.forEach((x: number) => { t += x; }); return t; }
function plain_array_objectAssign(): string {
    const seen: string[] = [];
    seen.push(show(array_objectAssign.map((x: number) => x * 2)));
    seen.push(show(array_objectAssign.includes(99)));
    seen.push(show(array_objectAssign.join("-")));
    seen.push(show(array_objectAssign.some((x: number) => x > 50)));
    seen.push(show(array_objectAssign.length));
    seen.push(show([...array_objectAssign]));
    seen.push(show(sumOf_array_objectAssign()));
    seen.push(show(eachOf_array_objectAssign()));
    seen.push(show(array_objectAssign.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_objectAssign(): void { Object.assign(array_objectAssign, { map: () => [-41] }); }
const map_objectAssign: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_objectAssign(): number { let t = 0; for (const [k, v] of map_objectAssign) t += v + k.length; return t; }
function eachOf_map_objectAssign(): number { let t = 0; map_objectAssign.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_objectAssign(): string {
    const seen: string[] = [];
    seen.push(show(map_objectAssign.get("a")));
    seen.push(show(map_objectAssign.has("zz")));
    seen.push(show(map_objectAssign.size));
    seen.push(show([...map_objectAssign.keys()]));
    seen.push(show(sumOf_map_objectAssign()));
    seen.push(show(eachOf_map_objectAssign()));
    return seen.join(" ");
}
function meddle_map_objectAssign(): void { Object.assign(map_objectAssign, { get: () => -41 }); }
const set_objectAssign: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_objectAssign(): number { let t = 0; for (const k of set_objectAssign) t += k.length; return t; }
function eachOf_set_objectAssign(): number { let t = 0; set_objectAssign.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_objectAssign(): string {
    const seen: string[] = [];
    seen.push(show(set_objectAssign.has("zz")));
    seen.push(show(set_objectAssign.size));
    seen.push(show([...set_objectAssign]));
    seen.push(show(sumOf_set_objectAssign()));
    seen.push(show(eachOf_set_objectAssign()));
    return seen.join(" ");
}
function meddle_set_objectAssign(): void { Object.assign(set_objectAssign, { has: () => true }); }
const array_frozen: number[] = [3, 1, 2];
function sumOf_array_frozen(): number { let t = 0; for (const x of array_frozen) t += x; return t; }
function eachOf_array_frozen(): number { let t = 0; array_frozen.forEach((x: number) => { t += x; }); return t; }
function plain_array_frozen(): string {
    const seen: string[] = [];
    seen.push(show(array_frozen.map((x: number) => x * 2)));
    seen.push(show(array_frozen.includes(99)));
    seen.push(show(array_frozen.join("-")));
    seen.push(show(array_frozen.some((x: number) => x > 50)));
    seen.push(show(array_frozen.length));
    seen.push(show([...array_frozen]));
    seen.push(show(sumOf_array_frozen()));
    seen.push(show(eachOf_array_frozen()));
    seen.push(show(array_frozen.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_frozen(): void { Object.freeze(array_frozen); }
const map_frozen: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_frozen(): number { let t = 0; for (const [k, v] of map_frozen) t += v + k.length; return t; }
function eachOf_map_frozen(): number { let t = 0; map_frozen.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_frozen(): string {
    const seen: string[] = [];
    seen.push(show(map_frozen.get("a")));
    seen.push(show(map_frozen.has("zz")));
    seen.push(show(map_frozen.size));
    seen.push(show([...map_frozen.keys()]));
    seen.push(show(sumOf_map_frozen()));
    seen.push(show(eachOf_map_frozen()));
    return seen.join(" ");
}
function meddle_map_frozen(): void { Object.freeze(map_frozen); }
const set_frozen: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_frozen(): number { let t = 0; for (const k of set_frozen) t += k.length; return t; }
function eachOf_set_frozen(): number { let t = 0; set_frozen.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_frozen(): string {
    const seen: string[] = [];
    seen.push(show(set_frozen.has("zz")));
    seen.push(show(set_frozen.size));
    seen.push(show([...set_frozen]));
    seen.push(show(sumOf_set_frozen()));
    seen.push(show(eachOf_set_frozen()));
    return seen.join(" ");
}
function meddle_set_frozen(): void { Object.freeze(set_frozen); }
const array_sealed: number[] = [3, 1, 2];
function sumOf_array_sealed(): number { let t = 0; for (const x of array_sealed) t += x; return t; }
function eachOf_array_sealed(): number { let t = 0; array_sealed.forEach((x: number) => { t += x; }); return t; }
function plain_array_sealed(): string {
    const seen: string[] = [];
    seen.push(show(array_sealed.map((x: number) => x * 2)));
    seen.push(show(array_sealed.includes(99)));
    seen.push(show(array_sealed.join("-")));
    seen.push(show(array_sealed.some((x: number) => x > 50)));
    seen.push(show(array_sealed.length));
    seen.push(show([...array_sealed]));
    seen.push(show(sumOf_array_sealed()));
    seen.push(show(eachOf_array_sealed()));
    seen.push(show(array_sealed.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_sealed(): void { Object.seal(array_sealed); }
const map_sealed: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_sealed(): number { let t = 0; for (const [k, v] of map_sealed) t += v + k.length; return t; }
function eachOf_map_sealed(): number { let t = 0; map_sealed.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_sealed(): string {
    const seen: string[] = [];
    seen.push(show(map_sealed.get("a")));
    seen.push(show(map_sealed.has("zz")));
    seen.push(show(map_sealed.size));
    seen.push(show([...map_sealed.keys()]));
    seen.push(show(sumOf_map_sealed()));
    seen.push(show(eachOf_map_sealed()));
    return seen.join(" ");
}
function meddle_map_sealed(): void { Object.seal(map_sealed); }
const set_sealed: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_sealed(): number { let t = 0; for (const k of set_sealed) t += k.length; return t; }
function eachOf_set_sealed(): number { let t = 0; set_sealed.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_sealed(): string {
    const seen: string[] = [];
    seen.push(show(set_sealed.has("zz")));
    seen.push(show(set_sealed.size));
    seen.push(show([...set_sealed]));
    seen.push(show(sumOf_set_sealed()));
    seen.push(show(eachOf_set_sealed()));
    return seen.join(" ");
}
function meddle_set_sealed(): void { Object.seal(set_sealed); }
const array_notExtensible: number[] = [3, 1, 2];
function sumOf_array_notExtensible(): number { let t = 0; for (const x of array_notExtensible) t += x; return t; }
function eachOf_array_notExtensible(): number { let t = 0; array_notExtensible.forEach((x: number) => { t += x; }); return t; }
function plain_array_notExtensible(): string {
    const seen: string[] = [];
    seen.push(show(array_notExtensible.map((x: number) => x * 2)));
    seen.push(show(array_notExtensible.includes(99)));
    seen.push(show(array_notExtensible.join("-")));
    seen.push(show(array_notExtensible.some((x: number) => x > 50)));
    seen.push(show(array_notExtensible.length));
    seen.push(show([...array_notExtensible]));
    seen.push(show(sumOf_array_notExtensible()));
    seen.push(show(eachOf_array_notExtensible()));
    seen.push(show(array_notExtensible.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_notExtensible(): void { Object.preventExtensions(array_notExtensible); }
const map_notExtensible: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_notExtensible(): number { let t = 0; for (const [k, v] of map_notExtensible) t += v + k.length; return t; }
function eachOf_map_notExtensible(): number { let t = 0; map_notExtensible.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_notExtensible(): string {
    const seen: string[] = [];
    seen.push(show(map_notExtensible.get("a")));
    seen.push(show(map_notExtensible.has("zz")));
    seen.push(show(map_notExtensible.size));
    seen.push(show([...map_notExtensible.keys()]));
    seen.push(show(sumOf_map_notExtensible()));
    seen.push(show(eachOf_map_notExtensible()));
    return seen.join(" ");
}
function meddle_map_notExtensible(): void { Object.preventExtensions(map_notExtensible); }
const set_notExtensible: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_notExtensible(): number { let t = 0; for (const k of set_notExtensible) t += k.length; return t; }
function eachOf_set_notExtensible(): number { let t = 0; set_notExtensible.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_notExtensible(): string {
    const seen: string[] = [];
    seen.push(show(set_notExtensible.has("zz")));
    seen.push(show(set_notExtensible.size));
    seen.push(show([...set_notExtensible]));
    seen.push(show(sumOf_set_notExtensible()));
    seen.push(show(eachOf_set_notExtensible()));
    return seen.join(" ");
}
function meddle_set_notExtensible(): void { Object.preventExtensions(set_notExtensible); }
const array_frozenAtBirth: number[] = Object.freeze([3, 1, 2]) as number[];
function sumOf_array_frozenAtBirth(): number { let t = 0; for (const x of array_frozenAtBirth) t += x; return t; }
function eachOf_array_frozenAtBirth(): number { let t = 0; array_frozenAtBirth.forEach((x: number) => { t += x; }); return t; }
function plain_array_frozenAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(array_frozenAtBirth.map((x: number) => x * 2)));
    seen.push(show(array_frozenAtBirth.includes(99)));
    seen.push(show(array_frozenAtBirth.join("-")));
    seen.push(show(array_frozenAtBirth.some((x: number) => x > 50)));
    seen.push(show(array_frozenAtBirth.length));
    seen.push(show([...array_frozenAtBirth]));
    seen.push(show(sumOf_array_frozenAtBirth()));
    seen.push(show(eachOf_array_frozenAtBirth()));
    seen.push(show(array_frozenAtBirth.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_frozenAtBirth(): void {  }
const map_frozenAtBirth: Map<string, number> = Object.freeze(new Map<string, number>([["a", 1], ["b", 2]])) as Map<string, number>;
function sumOf_map_frozenAtBirth(): number { let t = 0; for (const [k, v] of map_frozenAtBirth) t += v + k.length; return t; }
function eachOf_map_frozenAtBirth(): number { let t = 0; map_frozenAtBirth.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_frozenAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(map_frozenAtBirth.get("a")));
    seen.push(show(map_frozenAtBirth.has("zz")));
    seen.push(show(map_frozenAtBirth.size));
    seen.push(show([...map_frozenAtBirth.keys()]));
    seen.push(show(sumOf_map_frozenAtBirth()));
    seen.push(show(eachOf_map_frozenAtBirth()));
    return seen.join(" ");
}
function meddle_map_frozenAtBirth(): void {  }
const set_frozenAtBirth: Set<string> = Object.freeze(new Set<string>(["a", "b"])) as Set<string>;
function sumOf_set_frozenAtBirth(): number { let t = 0; for (const k of set_frozenAtBirth) t += k.length; return t; }
function eachOf_set_frozenAtBirth(): number { let t = 0; set_frozenAtBirth.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_frozenAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(set_frozenAtBirth.has("zz")));
    seen.push(show(set_frozenAtBirth.size));
    seen.push(show([...set_frozenAtBirth]));
    seen.push(show(sumOf_set_frozenAtBirth()));
    seen.push(show(eachOf_set_frozenAtBirth()));
    return seen.join(" ");
}
function meddle_set_frozenAtBirth(): void {  }
const array_assignedAtBirth: number[] = Object.assign([3, 1, 2], { map: () => [-41] }) as number[];
function sumOf_array_assignedAtBirth(): number { let t = 0; for (const x of array_assignedAtBirth) t += x; return t; }
function eachOf_array_assignedAtBirth(): number { let t = 0; array_assignedAtBirth.forEach((x: number) => { t += x; }); return t; }
function plain_array_assignedAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(array_assignedAtBirth.map((x: number) => x * 2)));
    seen.push(show(array_assignedAtBirth.includes(99)));
    seen.push(show(array_assignedAtBirth.join("-")));
    seen.push(show(array_assignedAtBirth.some((x: number) => x > 50)));
    seen.push(show(array_assignedAtBirth.length));
    seen.push(show([...array_assignedAtBirth]));
    seen.push(show(sumOf_array_assignedAtBirth()));
    seen.push(show(eachOf_array_assignedAtBirth()));
    seen.push(show(array_assignedAtBirth.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_assignedAtBirth(): void {  }
const map_assignedAtBirth: Map<string, number> = Object.assign(new Map<string, number>([["a", 1], ["b", 2]]), { get: () => -41 }) as Map<string, number>;
function sumOf_map_assignedAtBirth(): number { let t = 0; for (const [k, v] of map_assignedAtBirth) t += v + k.length; return t; }
function eachOf_map_assignedAtBirth(): number { let t = 0; map_assignedAtBirth.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_assignedAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(map_assignedAtBirth.get("a")));
    seen.push(show(map_assignedAtBirth.has("zz")));
    seen.push(show(map_assignedAtBirth.size));
    seen.push(show([...map_assignedAtBirth.keys()]));
    seen.push(show(sumOf_map_assignedAtBirth()));
    seen.push(show(eachOf_map_assignedAtBirth()));
    return seen.join(" ");
}
function meddle_map_assignedAtBirth(): void {  }
const set_assignedAtBirth: Set<string> = Object.assign(new Set<string>(["a", "b"]), { has: () => true }) as Set<string>;
function sumOf_set_assignedAtBirth(): number { let t = 0; for (const k of set_assignedAtBirth) t += k.length; return t; }
function eachOf_set_assignedAtBirth(): number { let t = 0; set_assignedAtBirth.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_assignedAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(set_assignedAtBirth.has("zz")));
    seen.push(show(set_assignedAtBirth.size));
    seen.push(show([...set_assignedAtBirth]));
    seen.push(show(sumOf_set_assignedAtBirth()));
    seen.push(show(eachOf_set_assignedAtBirth()));
    return seen.join(" ");
}
function meddle_set_assignedAtBirth(): void {  }
const array_anHeirAtBirth: number[] = ArrayHeir.from([3, 1, 2]) as ArrayHeir;
function sumOf_array_anHeirAtBirth(): number { let t = 0; for (const x of array_anHeirAtBirth) t += x; return t; }
function eachOf_array_anHeirAtBirth(): number { let t = 0; array_anHeirAtBirth.forEach((x: number) => { t += x; }); return t; }
function plain_array_anHeirAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(array_anHeirAtBirth.map((x: number) => x * 2)));
    seen.push(show(array_anHeirAtBirth.includes(99)));
    seen.push(show(array_anHeirAtBirth.join("-")));
    seen.push(show(array_anHeirAtBirth.some((x: number) => x > 50)));
    seen.push(show(array_anHeirAtBirth.length));
    seen.push(show([...array_anHeirAtBirth]));
    seen.push(show(sumOf_array_anHeirAtBirth()));
    seen.push(show(eachOf_array_anHeirAtBirth()));
    seen.push(show(array_anHeirAtBirth.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_anHeirAtBirth(): void {  }
const map_anHeirAtBirth: Map<string, number> = new MapHeir([["a", 1], ["b", 2]]);
function sumOf_map_anHeirAtBirth(): number { let t = 0; for (const [k, v] of map_anHeirAtBirth) t += v + k.length; return t; }
function eachOf_map_anHeirAtBirth(): number { let t = 0; map_anHeirAtBirth.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_anHeirAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(map_anHeirAtBirth.get("a")));
    seen.push(show(map_anHeirAtBirth.has("zz")));
    seen.push(show(map_anHeirAtBirth.size));
    seen.push(show([...map_anHeirAtBirth.keys()]));
    seen.push(show(sumOf_map_anHeirAtBirth()));
    seen.push(show(eachOf_map_anHeirAtBirth()));
    return seen.join(" ");
}
function meddle_map_anHeirAtBirth(): void {  }
const set_anHeirAtBirth: Set<string> = new SetHeir(["a", "b"]);
function sumOf_set_anHeirAtBirth(): number { let t = 0; for (const k of set_anHeirAtBirth) t += k.length; return t; }
function eachOf_set_anHeirAtBirth(): number { let t = 0; set_anHeirAtBirth.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_anHeirAtBirth(): string {
    const seen: string[] = [];
    seen.push(show(set_anHeirAtBirth.has("zz")));
    seen.push(show(set_anHeirAtBirth.size));
    seen.push(show([...set_anHeirAtBirth]));
    seen.push(show(sumOf_set_anHeirAtBirth()));
    seen.push(show(eachOf_set_anHeirAtBirth()));
    return seen.join(" ");
}
function meddle_set_anHeirAtBirth(): void {  }
let array_anHeirLater: number[] = [3, 1, 2];
function sumOf_array_anHeirLater(): number { let t = 0; for (const x of array_anHeirLater) t += x; return t; }
function eachOf_array_anHeirLater(): number { let t = 0; array_anHeirLater.forEach((x: number) => { t += x; }); return t; }
function plain_array_anHeirLater(): string {
    const seen: string[] = [];
    seen.push(show(array_anHeirLater.map((x: number) => x * 2)));
    seen.push(show(array_anHeirLater.includes(99)));
    seen.push(show(array_anHeirLater.join("-")));
    seen.push(show(array_anHeirLater.some((x: number) => x > 50)));
    seen.push(show(array_anHeirLater.length));
    seen.push(show([...array_anHeirLater]));
    seen.push(show(sumOf_array_anHeirLater()));
    seen.push(show(eachOf_array_anHeirLater()));
    seen.push(show(array_anHeirLater.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_anHeirLater(): void { array_anHeirLater = ArrayHeir.from([3, 1, 2]) as ArrayHeir; }
let map_anHeirLater: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_anHeirLater(): number { let t = 0; for (const [k, v] of map_anHeirLater) t += v + k.length; return t; }
function eachOf_map_anHeirLater(): number { let t = 0; map_anHeirLater.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_anHeirLater(): string {
    const seen: string[] = [];
    seen.push(show(map_anHeirLater.get("a")));
    seen.push(show(map_anHeirLater.has("zz")));
    seen.push(show(map_anHeirLater.size));
    seen.push(show([...map_anHeirLater.keys()]));
    seen.push(show(sumOf_map_anHeirLater()));
    seen.push(show(eachOf_map_anHeirLater()));
    return seen.join(" ");
}
function meddle_map_anHeirLater(): void { map_anHeirLater = new MapHeir([["a", 1], ["b", 2]]); }
let set_anHeirLater: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_anHeirLater(): number { let t = 0; for (const k of set_anHeirLater) t += k.length; return t; }
function eachOf_set_anHeirLater(): number { let t = 0; set_anHeirLater.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_anHeirLater(): string {
    const seen: string[] = [];
    seen.push(show(set_anHeirLater.has("zz")));
    seen.push(show(set_anHeirLater.size));
    seen.push(show([...set_anHeirLater]));
    seen.push(show(sumOf_set_anHeirLater()));
    seen.push(show(eachOf_set_anHeirLater()));
    return seen.join(" ");
}
function meddle_set_anHeirLater(): void { set_anHeirLater = new SetHeir(["a", "b"]); }
let array_anotherLater: number[] = [3, 1, 2];
function sumOf_array_anotherLater(): number { let t = 0; for (const x of array_anotherLater) t += x; return t; }
function eachOf_array_anotherLater(): number { let t = 0; array_anotherLater.forEach((x: number) => { t += x; }); return t; }
function plain_array_anotherLater(): string {
    const seen: string[] = [];
    seen.push(show(array_anotherLater.map((x: number) => x * 2)));
    seen.push(show(array_anotherLater.includes(99)));
    seen.push(show(array_anotherLater.join("-")));
    seen.push(show(array_anotherLater.some((x: number) => x > 50)));
    seen.push(show(array_anotherLater.length));
    seen.push(show([...array_anotherLater]));
    seen.push(show(sumOf_array_anotherLater()));
    seen.push(show(eachOf_array_anotherLater()));
    seen.push(show(array_anotherLater.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_anotherLater(): void { array_anotherLater = [3, 1, 2]; }
let map_anotherLater: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_anotherLater(): number { let t = 0; for (const [k, v] of map_anotherLater) t += v + k.length; return t; }
function eachOf_map_anotherLater(): number { let t = 0; map_anotherLater.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_anotherLater(): string {
    const seen: string[] = [];
    seen.push(show(map_anotherLater.get("a")));
    seen.push(show(map_anotherLater.has("zz")));
    seen.push(show(map_anotherLater.size));
    seen.push(show([...map_anotherLater.keys()]));
    seen.push(show(sumOf_map_anotherLater()));
    seen.push(show(eachOf_map_anotherLater()));
    return seen.join(" ");
}
function meddle_map_anotherLater(): void { map_anotherLater = new Map<string, number>([["a", 1], ["b", 2]]); }
let set_anotherLater: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_anotherLater(): number { let t = 0; for (const k of set_anotherLater) t += k.length; return t; }
function eachOf_set_anotherLater(): number { let t = 0; set_anotherLater.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_anotherLater(): string {
    const seen: string[] = [];
    seen.push(show(set_anotherLater.has("zz")));
    seen.push(show(set_anotherLater.size));
    seen.push(show([...set_anotherLater]));
    seen.push(show(sumOf_set_anotherLater()));
    seen.push(show(eachOf_set_anotherLater()));
    return seen.join(" ");
}
function meddle_set_anotherLater(): void { set_anotherLater = new Set<string>(["a", "b"]); }
let array_anotherLaterThatIsKept: number[] = [3, 1, 2];
function sumOf_array_anotherLaterThatIsKept(): number { let t = 0; for (const x of array_anotherLaterThatIsKept) t += x; return t; }
function eachOf_array_anotherLaterThatIsKept(): number { let t = 0; array_anotherLaterThatIsKept.forEach((x: number) => { t += x; }); return t; }
function plain_array_anotherLaterThatIsKept(): string {
    const seen: string[] = [];
    seen.push(show(array_anotherLaterThatIsKept.map((x: number) => x * 2)));
    seen.push(show(array_anotherLaterThatIsKept.includes(99)));
    seen.push(show(array_anotherLaterThatIsKept.join("-")));
    seen.push(show(array_anotherLaterThatIsKept.some((x: number) => x > 50)));
    seen.push(show(array_anotherLaterThatIsKept.length));
    seen.push(show([...array_anotherLaterThatIsKept]));
    seen.push(show(sumOf_array_anotherLaterThatIsKept()));
    seen.push(show(eachOf_array_anotherLaterThatIsKept()));
    seen.push(show(array_anotherLaterThatIsKept.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_anotherLaterThatIsKept(): void { const next: number[] = [3, 1, 2]; holder.it = next; array_anotherLaterThatIsKept = next; alter(holder.it); }
let map_anotherLaterThatIsKept: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_anotherLaterThatIsKept(): number { let t = 0; for (const [k, v] of map_anotherLaterThatIsKept) t += v + k.length; return t; }
function eachOf_map_anotherLaterThatIsKept(): number { let t = 0; map_anotherLaterThatIsKept.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_anotherLaterThatIsKept(): string {
    const seen: string[] = [];
    seen.push(show(map_anotherLaterThatIsKept.get("a")));
    seen.push(show(map_anotherLaterThatIsKept.has("zz")));
    seen.push(show(map_anotherLaterThatIsKept.size));
    seen.push(show([...map_anotherLaterThatIsKept.keys()]));
    seen.push(show(sumOf_map_anotherLaterThatIsKept()));
    seen.push(show(eachOf_map_anotherLaterThatIsKept()));
    return seen.join(" ");
}
function meddle_map_anotherLaterThatIsKept(): void { const next: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]); holder.it = next; map_anotherLaterThatIsKept = next; alter(holder.it); }
let set_anotherLaterThatIsKept: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_anotherLaterThatIsKept(): number { let t = 0; for (const k of set_anotherLaterThatIsKept) t += k.length; return t; }
function eachOf_set_anotherLaterThatIsKept(): number { let t = 0; set_anotherLaterThatIsKept.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_anotherLaterThatIsKept(): string {
    const seen: string[] = [];
    seen.push(show(set_anotherLaterThatIsKept.has("zz")));
    seen.push(show(set_anotherLaterThatIsKept.size));
    seen.push(show([...set_anotherLaterThatIsKept]));
    seen.push(show(sumOf_set_anotherLaterThatIsKept()));
    seen.push(show(eachOf_set_anotherLaterThatIsKept()));
    return seen.join(" ");
}
function meddle_set_anotherLaterThatIsKept(): void { const next: Set<string> = new Set<string>(["a", "b"]); holder.it = next; set_anotherLaterThatIsKept = next; alter(holder.it); }
let array_givenLater: number[] = [3, 1, 2];
function sumOf_array_givenLater(): number { let t = 0; for (const x of array_givenLater) t += x; return t; }
function eachOf_array_givenLater(): number { let t = 0; array_givenLater.forEach((x: number) => { t += x; }); return t; }
function plain_array_givenLater(): string {
    const seen: string[] = [];
    seen.push(show(array_givenLater.map((x: number) => x * 2)));
    seen.push(show(array_givenLater.includes(99)));
    seen.push(show(array_givenLater.join("-")));
    seen.push(show(array_givenLater.some((x: number) => x > 50)));
    seen.push(show(array_givenLater.length));
    seen.push(show([...array_givenLater]));
    seen.push(show(sumOf_array_givenLater()));
    seen.push(show(eachOf_array_givenLater()));
    seen.push(show(array_givenLater.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_givenLater(): void { holder.it = [3, 1, 2]; alter(holder.it); array_givenLater = holder.it; }
let map_givenLater: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_givenLater(): number { let t = 0; for (const [k, v] of map_givenLater) t += v + k.length; return t; }
function eachOf_map_givenLater(): number { let t = 0; map_givenLater.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_givenLater(): string {
    const seen: string[] = [];
    seen.push(show(map_givenLater.get("a")));
    seen.push(show(map_givenLater.has("zz")));
    seen.push(show(map_givenLater.size));
    seen.push(show([...map_givenLater.keys()]));
    seen.push(show(sumOf_map_givenLater()));
    seen.push(show(eachOf_map_givenLater()));
    return seen.join(" ");
}
function meddle_map_givenLater(): void { holder.it = new Map<string, number>([["a", 1], ["b", 2]]); alter(holder.it); map_givenLater = holder.it; }
let set_givenLater: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_givenLater(): number { let t = 0; for (const k of set_givenLater) t += k.length; return t; }
function eachOf_set_givenLater(): number { let t = 0; set_givenLater.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_givenLater(): string {
    const seen: string[] = [];
    seen.push(show(set_givenLater.has("zz")));
    seen.push(show(set_givenLater.size));
    seen.push(show([...set_givenLater]));
    seen.push(show(sumOf_set_givenLater()));
    seen.push(show(eachOf_set_givenLater()));
    return seen.join(" ");
}
function meddle_set_givenLater(): void { holder.it = new Set<string>(["a", "b"]); alter(holder.it); set_givenLater = holder.it; }
let array_undefinedLater: number[] = [3, 1, 2];
function sumOf_array_undefinedLater(): number { let t = 0; for (const x of array_undefinedLater) t += x; return t; }
function eachOf_array_undefinedLater(): number { let t = 0; array_undefinedLater.forEach((x: number) => { t += x; }); return t; }
function plain_array_undefinedLater(): string {
    const seen: string[] = [];
    seen.push(show(array_undefinedLater.map((x: number) => x * 2)));
    seen.push(show(array_undefinedLater.includes(99)));
    seen.push(show(array_undefinedLater.join("-")));
    seen.push(show(array_undefinedLater.some((x: number) => x > 50)));
    seen.push(show(array_undefinedLater.length));
    seen.push(show([...array_undefinedLater]));
    seen.push(show(sumOf_array_undefinedLater()));
    seen.push(show(eachOf_array_undefinedLater()));
    seen.push(show(array_undefinedLater.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_undefinedLater(): void { array_undefinedLater = undefined as any; }
let map_undefinedLater: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_undefinedLater(): number { let t = 0; for (const [k, v] of map_undefinedLater) t += v + k.length; return t; }
function eachOf_map_undefinedLater(): number { let t = 0; map_undefinedLater.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_undefinedLater(): string {
    const seen: string[] = [];
    seen.push(show(map_undefinedLater.get("a")));
    seen.push(show(map_undefinedLater.has("zz")));
    seen.push(show(map_undefinedLater.size));
    seen.push(show([...map_undefinedLater.keys()]));
    seen.push(show(sumOf_map_undefinedLater()));
    seen.push(show(eachOf_map_undefinedLater()));
    return seen.join(" ");
}
function meddle_map_undefinedLater(): void { map_undefinedLater = undefined as any; }
let set_undefinedLater: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_undefinedLater(): number { let t = 0; for (const k of set_undefinedLater) t += k.length; return t; }
function eachOf_set_undefinedLater(): number { let t = 0; set_undefinedLater.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_undefinedLater(): string {
    const seen: string[] = [];
    seen.push(show(set_undefinedLater.has("zz")));
    seen.push(show(set_undefinedLater.size));
    seen.push(show([...set_undefinedLater]));
    seen.push(show(sumOf_set_undefinedLater()));
    seen.push(show(eachOf_set_undefinedLater()));
    return seen.join(" ");
}
function meddle_set_undefinedLater(): void { set_undefinedLater = undefined as any; }
let array_nullLater: number[] = [3, 1, 2];
function sumOf_array_nullLater(): number { let t = 0; for (const x of array_nullLater) t += x; return t; }
function eachOf_array_nullLater(): number { let t = 0; array_nullLater.forEach((x: number) => { t += x; }); return t; }
function plain_array_nullLater(): string {
    const seen: string[] = [];
    seen.push(show(array_nullLater.map((x: number) => x * 2)));
    seen.push(show(array_nullLater.includes(99)));
    seen.push(show(array_nullLater.join("-")));
    seen.push(show(array_nullLater.some((x: number) => x > 50)));
    seen.push(show(array_nullLater.length));
    seen.push(show([...array_nullLater]));
    seen.push(show(sumOf_array_nullLater()));
    seen.push(show(eachOf_array_nullLater()));
    seen.push(show(array_nullLater.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_nullLater(): void { array_nullLater = null as any; }
let map_nullLater: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_nullLater(): number { let t = 0; for (const [k, v] of map_nullLater) t += v + k.length; return t; }
function eachOf_map_nullLater(): number { let t = 0; map_nullLater.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_nullLater(): string {
    const seen: string[] = [];
    seen.push(show(map_nullLater.get("a")));
    seen.push(show(map_nullLater.has("zz")));
    seen.push(show(map_nullLater.size));
    seen.push(show([...map_nullLater.keys()]));
    seen.push(show(sumOf_map_nullLater()));
    seen.push(show(eachOf_map_nullLater()));
    return seen.join(" ");
}
function meddle_map_nullLater(): void { map_nullLater = null as any; }
let set_nullLater: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_nullLater(): number { let t = 0; for (const k of set_nullLater) t += k.length; return t; }
function eachOf_set_nullLater(): number { let t = 0; set_nullLater.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_nullLater(): string {
    const seen: string[] = [];
    seen.push(show(set_nullLater.has("zz")));
    seen.push(show(set_nullLater.size));
    seen.push(show([...set_nullLater]));
    seen.push(show(sumOf_set_nullLater()));
    seen.push(show(eachOf_set_nullLater()));
    return seen.join(" ");
}
function meddle_set_nullLater(): void { set_nullLater = null as any; }
let array_undefinedOnOneRoad: number[] = [3, 1, 2];
function sumOf_array_undefinedOnOneRoad(): number { let t = 0; for (const x of array_undefinedOnOneRoad) t += x; return t; }
function eachOf_array_undefinedOnOneRoad(): number { let t = 0; array_undefinedOnOneRoad.forEach((x: number) => { t += x; }); return t; }
function plain_array_undefinedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(array_undefinedOnOneRoad.map((x: number) => x * 2)));
    seen.push(show(array_undefinedOnOneRoad.includes(99)));
    seen.push(show(array_undefinedOnOneRoad.join("-")));
    seen.push(show(array_undefinedOnOneRoad.some((x: number) => x > 50)));
    seen.push(show(array_undefinedOnOneRoad.length));
    seen.push(show([...array_undefinedOnOneRoad]));
    seen.push(show(sumOf_array_undefinedOnOneRoad()));
    seen.push(show(eachOf_array_undefinedOnOneRoad()));
    seen.push(show(array_undefinedOnOneRoad.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_undefinedOnOneRoad(): void { if (yes) array_undefinedOnOneRoad = undefined as any; }
let map_undefinedOnOneRoad: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_undefinedOnOneRoad(): number { let t = 0; for (const [k, v] of map_undefinedOnOneRoad) t += v + k.length; return t; }
function eachOf_map_undefinedOnOneRoad(): number { let t = 0; map_undefinedOnOneRoad.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_undefinedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(map_undefinedOnOneRoad.get("a")));
    seen.push(show(map_undefinedOnOneRoad.has("zz")));
    seen.push(show(map_undefinedOnOneRoad.size));
    seen.push(show([...map_undefinedOnOneRoad.keys()]));
    seen.push(show(sumOf_map_undefinedOnOneRoad()));
    seen.push(show(eachOf_map_undefinedOnOneRoad()));
    return seen.join(" ");
}
function meddle_map_undefinedOnOneRoad(): void { if (yes) map_undefinedOnOneRoad = undefined as any; }
let set_undefinedOnOneRoad: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_undefinedOnOneRoad(): number { let t = 0; for (const k of set_undefinedOnOneRoad) t += k.length; return t; }
function eachOf_set_undefinedOnOneRoad(): number { let t = 0; set_undefinedOnOneRoad.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_undefinedOnOneRoad(): string {
    const seen: string[] = [];
    seen.push(show(set_undefinedOnOneRoad.has("zz")));
    seen.push(show(set_undefinedOnOneRoad.size));
    seen.push(show([...set_undefinedOnOneRoad]));
    seen.push(show(sumOf_set_undefinedOnOneRoad()));
    seen.push(show(eachOf_set_undefinedOnOneRoad()));
    return seen.join(" ");
}
function meddle_set_undefinedOnOneRoad(): void { if (yes) set_undefinedOnOneRoad = undefined as any; }
let array_undefinedThenAnother: number[] = [3, 1, 2];
function sumOf_array_undefinedThenAnother(): number { let t = 0; for (const x of array_undefinedThenAnother) t += x; return t; }
function eachOf_array_undefinedThenAnother(): number { let t = 0; array_undefinedThenAnother.forEach((x: number) => { t += x; }); return t; }
function plain_array_undefinedThenAnother(): string {
    const seen: string[] = [];
    seen.push(show(array_undefinedThenAnother.map((x: number) => x * 2)));
    seen.push(show(array_undefinedThenAnother.includes(99)));
    seen.push(show(array_undefinedThenAnother.join("-")));
    seen.push(show(array_undefinedThenAnother.some((x: number) => x > 50)));
    seen.push(show(array_undefinedThenAnother.length));
    seen.push(show([...array_undefinedThenAnother]));
    seen.push(show(sumOf_array_undefinedThenAnother()));
    seen.push(show(eachOf_array_undefinedThenAnother()));
    seen.push(show(array_undefinedThenAnother.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_undefinedThenAnother(): void { array_undefinedThenAnother = undefined as any; marks += array_undefinedThenAnother === undefined ? 1 : 0; array_undefinedThenAnother = [3, 1, 2]; }
let map_undefinedThenAnother: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_undefinedThenAnother(): number { let t = 0; for (const [k, v] of map_undefinedThenAnother) t += v + k.length; return t; }
function eachOf_map_undefinedThenAnother(): number { let t = 0; map_undefinedThenAnother.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_undefinedThenAnother(): string {
    const seen: string[] = [];
    seen.push(show(map_undefinedThenAnother.get("a")));
    seen.push(show(map_undefinedThenAnother.has("zz")));
    seen.push(show(map_undefinedThenAnother.size));
    seen.push(show([...map_undefinedThenAnother.keys()]));
    seen.push(show(sumOf_map_undefinedThenAnother()));
    seen.push(show(eachOf_map_undefinedThenAnother()));
    return seen.join(" ");
}
function meddle_map_undefinedThenAnother(): void { map_undefinedThenAnother = undefined as any; marks += map_undefinedThenAnother === undefined ? 1 : 0; map_undefinedThenAnother = new Map<string, number>([["a", 1], ["b", 2]]); }
let set_undefinedThenAnother: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_undefinedThenAnother(): number { let t = 0; for (const k of set_undefinedThenAnother) t += k.length; return t; }
function eachOf_set_undefinedThenAnother(): number { let t = 0; set_undefinedThenAnother.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_undefinedThenAnother(): string {
    const seen: string[] = [];
    seen.push(show(set_undefinedThenAnother.has("zz")));
    seen.push(show(set_undefinedThenAnother.size));
    seen.push(show([...set_undefinedThenAnother]));
    seen.push(show(sumOf_set_undefinedThenAnother()));
    seen.push(show(eachOf_set_undefinedThenAnother()));
    return seen.join(" ");
}
function meddle_set_undefinedThenAnother(): void { set_undefinedThenAnother = undefined as any; marks += set_undefinedThenAnother === undefined ? 1 : 0; set_undefinedThenAnother = new Set<string>(["a", "b"]); }
try { lines.push("array_usedBeforeItsDeclaration early: " + plain_array_usedBeforeItsDeclaration()); } catch (e) { lines.push("array_usedBeforeItsDeclaration early: " + thrown(e)); }
const array_usedBeforeItsDeclaration: number[] = [3, 1, 2];
function sumOf_array_usedBeforeItsDeclaration(): number { let t = 0; for (const x of array_usedBeforeItsDeclaration) t += x; return t; }
function eachOf_array_usedBeforeItsDeclaration(): number { let t = 0; array_usedBeforeItsDeclaration.forEach((x: number) => { t += x; }); return t; }
function plain_array_usedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(array_usedBeforeItsDeclaration.map((x: number) => x * 2)));
    seen.push(show(array_usedBeforeItsDeclaration.includes(99)));
    seen.push(show(array_usedBeforeItsDeclaration.join("-")));
    seen.push(show(array_usedBeforeItsDeclaration.some((x: number) => x > 50)));
    seen.push(show(array_usedBeforeItsDeclaration.length));
    seen.push(show([...array_usedBeforeItsDeclaration]));
    seen.push(show(sumOf_array_usedBeforeItsDeclaration()));
    seen.push(show(eachOf_array_usedBeforeItsDeclaration()));
    seen.push(show(array_usedBeforeItsDeclaration.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_usedBeforeItsDeclaration(): void {  }
try { lines.push("map_usedBeforeItsDeclaration early: " + plain_map_usedBeforeItsDeclaration()); } catch (e) { lines.push("map_usedBeforeItsDeclaration early: " + thrown(e)); }
const map_usedBeforeItsDeclaration: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_usedBeforeItsDeclaration(): number { let t = 0; for (const [k, v] of map_usedBeforeItsDeclaration) t += v + k.length; return t; }
function eachOf_map_usedBeforeItsDeclaration(): number { let t = 0; map_usedBeforeItsDeclaration.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_usedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(map_usedBeforeItsDeclaration.get("a")));
    seen.push(show(map_usedBeforeItsDeclaration.has("zz")));
    seen.push(show(map_usedBeforeItsDeclaration.size));
    seen.push(show([...map_usedBeforeItsDeclaration.keys()]));
    seen.push(show(sumOf_map_usedBeforeItsDeclaration()));
    seen.push(show(eachOf_map_usedBeforeItsDeclaration()));
    return seen.join(" ");
}
function meddle_map_usedBeforeItsDeclaration(): void {  }
try { lines.push("set_usedBeforeItsDeclaration early: " + plain_set_usedBeforeItsDeclaration()); } catch (e) { lines.push("set_usedBeforeItsDeclaration early: " + thrown(e)); }
const set_usedBeforeItsDeclaration: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_usedBeforeItsDeclaration(): number { let t = 0; for (const k of set_usedBeforeItsDeclaration) t += k.length; return t; }
function eachOf_set_usedBeforeItsDeclaration(): number { let t = 0; set_usedBeforeItsDeclaration.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_usedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(set_usedBeforeItsDeclaration.has("zz")));
    seen.push(show(set_usedBeforeItsDeclaration.size));
    seen.push(show([...set_usedBeforeItsDeclaration]));
    seen.push(show(sumOf_set_usedBeforeItsDeclaration()));
    seen.push(show(eachOf_set_usedBeforeItsDeclaration()));
    return seen.join(" ");
}
function meddle_set_usedBeforeItsDeclaration(): void {  }
try { lines.push("array_varUsedBeforeItsDeclaration early: " + plain_array_varUsedBeforeItsDeclaration()); } catch (e) { lines.push("array_varUsedBeforeItsDeclaration early: " + thrown(e)); }
var array_varUsedBeforeItsDeclaration: number[] = [3, 1, 2];
function sumOf_array_varUsedBeforeItsDeclaration(): number { let t = 0; for (const x of array_varUsedBeforeItsDeclaration) t += x; return t; }
function eachOf_array_varUsedBeforeItsDeclaration(): number { let t = 0; array_varUsedBeforeItsDeclaration.forEach((x: number) => { t += x; }); return t; }
function plain_array_varUsedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(array_varUsedBeforeItsDeclaration.map((x: number) => x * 2)));
    seen.push(show(array_varUsedBeforeItsDeclaration.includes(99)));
    seen.push(show(array_varUsedBeforeItsDeclaration.join("-")));
    seen.push(show(array_varUsedBeforeItsDeclaration.some((x: number) => x > 50)));
    seen.push(show(array_varUsedBeforeItsDeclaration.length));
    seen.push(show([...array_varUsedBeforeItsDeclaration]));
    seen.push(show(sumOf_array_varUsedBeforeItsDeclaration()));
    seen.push(show(eachOf_array_varUsedBeforeItsDeclaration()));
    seen.push(show(array_varUsedBeforeItsDeclaration.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_varUsedBeforeItsDeclaration(): void {  }
try { lines.push("map_varUsedBeforeItsDeclaration early: " + plain_map_varUsedBeforeItsDeclaration()); } catch (e) { lines.push("map_varUsedBeforeItsDeclaration early: " + thrown(e)); }
var map_varUsedBeforeItsDeclaration: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_varUsedBeforeItsDeclaration(): number { let t = 0; for (const [k, v] of map_varUsedBeforeItsDeclaration) t += v + k.length; return t; }
function eachOf_map_varUsedBeforeItsDeclaration(): number { let t = 0; map_varUsedBeforeItsDeclaration.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_varUsedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(map_varUsedBeforeItsDeclaration.get("a")));
    seen.push(show(map_varUsedBeforeItsDeclaration.has("zz")));
    seen.push(show(map_varUsedBeforeItsDeclaration.size));
    seen.push(show([...map_varUsedBeforeItsDeclaration.keys()]));
    seen.push(show(sumOf_map_varUsedBeforeItsDeclaration()));
    seen.push(show(eachOf_map_varUsedBeforeItsDeclaration()));
    return seen.join(" ");
}
function meddle_map_varUsedBeforeItsDeclaration(): void {  }
try { lines.push("set_varUsedBeforeItsDeclaration early: " + plain_set_varUsedBeforeItsDeclaration()); } catch (e) { lines.push("set_varUsedBeforeItsDeclaration early: " + thrown(e)); }
var set_varUsedBeforeItsDeclaration: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_varUsedBeforeItsDeclaration(): number { let t = 0; for (const k of set_varUsedBeforeItsDeclaration) t += k.length; return t; }
function eachOf_set_varUsedBeforeItsDeclaration(): number { let t = 0; set_varUsedBeforeItsDeclaration.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_varUsedBeforeItsDeclaration(): string {
    const seen: string[] = [];
    seen.push(show(set_varUsedBeforeItsDeclaration.has("zz")));
    seen.push(show(set_varUsedBeforeItsDeclaration.size));
    seen.push(show([...set_varUsedBeforeItsDeclaration]));
    seen.push(show(sumOf_set_varUsedBeforeItsDeclaration()));
    seen.push(show(eachOf_set_varUsedBeforeItsDeclaration()));
    return seen.join(" ");
}
function meddle_set_varUsedBeforeItsDeclaration(): void {  }
const array_aNamedProperty: number[] = [3, 1, 2];
function sumOf_array_aNamedProperty(): number { let t = 0; for (const x of array_aNamedProperty) t += x; return t; }
function eachOf_array_aNamedProperty(): number { let t = 0; array_aNamedProperty.forEach((x: number) => { t += x; }); return t; }
function plain_array_aNamedProperty(): string {
    const seen: string[] = [];
    seen.push(show(array_aNamedProperty.map((x: number) => x * 2)));
    seen.push(show(array_aNamedProperty.includes(99)));
    seen.push(show(array_aNamedProperty.join("-")));
    seen.push(show(array_aNamedProperty.some((x: number) => x > 50)));
    seen.push(show(array_aNamedProperty.length));
    seen.push(show([...array_aNamedProperty]));
    seen.push(show(sumOf_array_aNamedProperty()));
    seen.push(show(eachOf_array_aNamedProperty()));
    seen.push(show(array_aNamedProperty.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_aNamedProperty(): void { (array_aNamedProperty as any).extra = 1; }
const map_aNamedProperty: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_aNamedProperty(): number { let t = 0; for (const [k, v] of map_aNamedProperty) t += v + k.length; return t; }
function eachOf_map_aNamedProperty(): number { let t = 0; map_aNamedProperty.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_aNamedProperty(): string {
    const seen: string[] = [];
    seen.push(show(map_aNamedProperty.get("a")));
    seen.push(show(map_aNamedProperty.has("zz")));
    seen.push(show(map_aNamedProperty.size));
    seen.push(show([...map_aNamedProperty.keys()]));
    seen.push(show(sumOf_map_aNamedProperty()));
    seen.push(show(eachOf_map_aNamedProperty()));
    return seen.join(" ");
}
function meddle_map_aNamedProperty(): void { (map_aNamedProperty as any).extra = 1; }
const set_aNamedProperty: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_aNamedProperty(): number { let t = 0; for (const k of set_aNamedProperty) t += k.length; return t; }
function eachOf_set_aNamedProperty(): number { let t = 0; set_aNamedProperty.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_aNamedProperty(): string {
    const seen: string[] = [];
    seen.push(show(set_aNamedProperty.has("zz")));
    seen.push(show(set_aNamedProperty.size));
    seen.push(show([...set_aNamedProperty]));
    seen.push(show(sumOf_set_aNamedProperty()));
    seen.push(show(eachOf_set_aNamedProperty()));
    return seen.join(" ");
}
function meddle_set_aNamedProperty(): void { (set_aNamedProperty as any).extra = 1; }
const map_symbolIterator: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_symbolIterator(): number { let t = 0; for (const [k, v] of map_symbolIterator) t += v + k.length; return t; }
function eachOf_map_symbolIterator(): number { let t = 0; map_symbolIterator.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_symbolIterator(): string {
    const seen: string[] = [];
    seen.push(show(map_symbolIterator.get("a")));
    seen.push(show(map_symbolIterator.has("zz")));
    seen.push(show(map_symbolIterator.size));
    seen.push(show([...map_symbolIterator.keys()]));
    seen.push(show(sumOf_map_symbolIterator()));
    seen.push(show(eachOf_map_symbolIterator()));
    return seen.join(" ");
}
function meddle_map_symbolIterator(): void { (map_symbolIterator as any)[Symbol.iterator] = function* () { yield ["own", -42]; }; }
const set_symbolIterator: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_symbolIterator(): number { let t = 0; for (const k of set_symbolIterator) t += k.length; return t; }
function eachOf_set_symbolIterator(): number { let t = 0; set_symbolIterator.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_symbolIterator(): string {
    const seen: string[] = [];
    seen.push(show(set_symbolIterator.has("zz")));
    seen.push(show(set_symbolIterator.size));
    seen.push(show([...set_symbolIterator]));
    seen.push(show(sumOf_set_symbolIterator()));
    seen.push(show(eachOf_set_symbolIterator()));
    return seen.join(" ");
}
function meddle_set_symbolIterator(): void { (set_symbolIterator as any)[Symbol.iterator] = function* () { yield "own"; }; }
const array_jsonReplacer: number[] = [3, 1, 2];
function sumOf_array_jsonReplacer(): number { let t = 0; for (const x of array_jsonReplacer) t += x; return t; }
function eachOf_array_jsonReplacer(): number { let t = 0; array_jsonReplacer.forEach((x: number) => { t += x; }); return t; }
function plain_array_jsonReplacer(): string {
    const seen: string[] = [];
    seen.push(show(array_jsonReplacer.map((x: number) => x * 2)));
    seen.push(show(array_jsonReplacer.includes(99)));
    seen.push(show(array_jsonReplacer.join("-")));
    seen.push(show(array_jsonReplacer.some((x: number) => x > 50)));
    seen.push(show(array_jsonReplacer.length));
    seen.push(show([...array_jsonReplacer]));
    seen.push(show(sumOf_array_jsonReplacer()));
    seen.push(show(eachOf_array_jsonReplacer()));
    seen.push(show(array_jsonReplacer.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_jsonReplacer(): void { JSON.stringify(array_jsonReplacer, function (this: any, k: string, v: any): any { if (k === "0") alter(this); return v; }); }
const array_constructorSpecies: number[] = [3, 1, 2];
function sumOf_array_constructorSpecies(): number { let t = 0; for (const x of array_constructorSpecies) t += x; return t; }
function eachOf_array_constructorSpecies(): number { let t = 0; array_constructorSpecies.forEach((x: number) => { t += x; }); return t; }
function plain_array_constructorSpecies(): string {
    const seen: string[] = [];
    seen.push(show(array_constructorSpecies.map((x: number) => x * 2)));
    seen.push(show(array_constructorSpecies.includes(99)));
    seen.push(show(array_constructorSpecies.join("-")));
    seen.push(show(array_constructorSpecies.some((x: number) => x > 50)));
    seen.push(show(array_constructorSpecies.length));
    seen.push(show([...array_constructorSpecies]));
    seen.push(show(sumOf_array_constructorSpecies()));
    seen.push(show(eachOf_array_constructorSpecies()));
    seen.push(show(array_constructorSpecies.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_constructorSpecies(): void { (array_constructorSpecies as any).constructor = { [Symbol.species]: ArrayHeir }; }
const array_sortYieldsIt: number[] = [3, 1, 2];
function sumOf_array_sortYieldsIt(): number { let t = 0; for (const x of array_sortYieldsIt) t += x; return t; }
function eachOf_array_sortYieldsIt(): number { let t = 0; array_sortYieldsIt.forEach((x: number) => { t += x; }); return t; }
function plain_array_sortYieldsIt(): string {
    const seen: string[] = [];
    seen.push(show(array_sortYieldsIt.map((x: number) => x * 2)));
    seen.push(show(array_sortYieldsIt.includes(99)));
    seen.push(show(array_sortYieldsIt.join("-")));
    seen.push(show(array_sortYieldsIt.some((x: number) => x > 50)));
    seen.push(show(array_sortYieldsIt.length));
    seen.push(show([...array_sortYieldsIt]));
    seen.push(show(sumOf_array_sortYieldsIt()));
    seen.push(show(eachOf_array_sortYieldsIt()));
    seen.push(show(array_sortYieldsIt.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_sortYieldsIt(): void { alter(array_sortYieldsIt.sort()); }
const array_reverseYieldsIt: number[] = [3, 1, 2];
function sumOf_array_reverseYieldsIt(): number { let t = 0; for (const x of array_reverseYieldsIt) t += x; return t; }
function eachOf_array_reverseYieldsIt(): number { let t = 0; array_reverseYieldsIt.forEach((x: number) => { t += x; }); return t; }
function plain_array_reverseYieldsIt(): string {
    const seen: string[] = [];
    seen.push(show(array_reverseYieldsIt.map((x: number) => x * 2)));
    seen.push(show(array_reverseYieldsIt.includes(99)));
    seen.push(show(array_reverseYieldsIt.join("-")));
    seen.push(show(array_reverseYieldsIt.some((x: number) => x > 50)));
    seen.push(show(array_reverseYieldsIt.length));
    seen.push(show([...array_reverseYieldsIt]));
    seen.push(show(sumOf_array_reverseYieldsIt()));
    seen.push(show(eachOf_array_reverseYieldsIt()));
    seen.push(show(array_reverseYieldsIt.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_reverseYieldsIt(): void { alter(array_reverseYieldsIt.reverse()); }
const array_fillYieldsIt: number[] = [3, 1, 2];
function sumOf_array_fillYieldsIt(): number { let t = 0; for (const x of array_fillYieldsIt) t += x; return t; }
function eachOf_array_fillYieldsIt(): number { let t = 0; array_fillYieldsIt.forEach((x: number) => { t += x; }); return t; }
function plain_array_fillYieldsIt(): string {
    const seen: string[] = [];
    seen.push(show(array_fillYieldsIt.map((x: number) => x * 2)));
    seen.push(show(array_fillYieldsIt.includes(99)));
    seen.push(show(array_fillYieldsIt.join("-")));
    seen.push(show(array_fillYieldsIt.some((x: number) => x > 50)));
    seen.push(show(array_fillYieldsIt.length));
    seen.push(show([...array_fillYieldsIt]));
    seen.push(show(sumOf_array_fillYieldsIt()));
    seen.push(show(eachOf_array_fillYieldsIt()));
    seen.push(show(array_fillYieldsIt.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_fillYieldsIt(): void { alter(array_fillYieldsIt.fill(4, 2)); }
const array_fourthParameterOfReduce: number[] = [3, 1, 2];
function sumOf_array_fourthParameterOfReduce(): number { let t = 0; for (const x of array_fourthParameterOfReduce) t += x; return t; }
function eachOf_array_fourthParameterOfReduce(): number { let t = 0; array_fourthParameterOfReduce.forEach((x: number) => { t += x; }); return t; }
function plain_array_fourthParameterOfReduce(): string {
    const seen: string[] = [];
    seen.push(show(array_fourthParameterOfReduce.map((x: number) => x * 2)));
    seen.push(show(array_fourthParameterOfReduce.includes(99)));
    seen.push(show(array_fourthParameterOfReduce.join("-")));
    seen.push(show(array_fourthParameterOfReduce.some((x: number) => x > 50)));
    seen.push(show(array_fourthParameterOfReduce.length));
    seen.push(show([...array_fourthParameterOfReduce]));
    seen.push(show(sumOf_array_fourthParameterOfReduce()));
    seen.push(show(eachOf_array_fourthParameterOfReduce()));
    seen.push(show(array_fourthParameterOfReduce.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_fourthParameterOfReduce(): void { array_fourthParameterOfReduce.reduce((a: any, x: any, i: any, all: any) => { alter(all); return a; }, 0); }
const map_setYieldsIt: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_setYieldsIt(): number { let t = 0; for (const [k, v] of map_setYieldsIt) t += v + k.length; return t; }
function eachOf_map_setYieldsIt(): number { let t = 0; map_setYieldsIt.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_setYieldsIt(): string {
    const seen: string[] = [];
    seen.push(show(map_setYieldsIt.get("a")));
    seen.push(show(map_setYieldsIt.has("zz")));
    seen.push(show(map_setYieldsIt.size));
    seen.push(show([...map_setYieldsIt.keys()]));
    seen.push(show(sumOf_map_setYieldsIt()));
    seen.push(show(eachOf_map_setYieldsIt()));
    return seen.join(" ");
}
function meddle_map_setYieldsIt(): void { alter(map_setYieldsIt.set("d", 4)); }
const set_addYieldsIt: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_addYieldsIt(): number { let t = 0; for (const k of set_addYieldsIt) t += k.length; return t; }
function eachOf_set_addYieldsIt(): number { let t = 0; set_addYieldsIt.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_addYieldsIt(): string {
    const seen: string[] = [];
    seen.push(show(set_addYieldsIt.has("zz")));
    seen.push(show(set_addYieldsIt.size));
    seen.push(show([...set_addYieldsIt]));
    seen.push(show(sumOf_set_addYieldsIt()));
    seen.push(show(eachOf_set_addYieldsIt()));
    return seen.join(" ");
}
function meddle_set_addYieldsIt(): void { alter(set_addYieldsIt.add("d")); }
const array_lengthStored: number[] = [3, 1, 2];
function sumOf_array_lengthStored(): number { let t = 0; for (const x of array_lengthStored) t += x; return t; }
function eachOf_array_lengthStored(): number { let t = 0; array_lengthStored.forEach((x: number) => { t += x; }); return t; }
function plain_array_lengthStored(): string {
    const seen: string[] = [];
    seen.push(show(array_lengthStored.map((x: number) => x * 2)));
    seen.push(show(array_lengthStored.includes(99)));
    seen.push(show(array_lengthStored.join("-")));
    seen.push(show(array_lengthStored.some((x: number) => x > 50)));
    seen.push(show(array_lengthStored.length));
    seen.push(show([...array_lengthStored]));
    seen.push(show(sumOf_array_lengthStored()));
    seen.push(show(eachOf_array_lengthStored()));
    seen.push(show(array_lengthStored.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_lengthStored(): void { array_lengthStored.length = 1; }
const array_elementFarAway: number[] = [3, 1, 2];
function sumOf_array_elementFarAway(): number { let t = 0; for (const x of array_elementFarAway) t += x; return t; }
function eachOf_array_elementFarAway(): number { let t = 0; array_elementFarAway.forEach((x: number) => { t += x; }); return t; }
function plain_array_elementFarAway(): string {
    const seen: string[] = [];
    seen.push(show(array_elementFarAway.map((x: number) => x * 2)));
    seen.push(show(array_elementFarAway.includes(99)));
    seen.push(show(array_elementFarAway.join("-")));
    seen.push(show(array_elementFarAway.some((x: number) => x > 50)));
    seen.push(show(array_elementFarAway.length));
    seen.push(show([...array_elementFarAway]));
    seen.push(show(sumOf_array_elementFarAway()));
    seen.push(show(eachOf_array_elementFarAway()));
    seen.push(show(array_elementFarAway.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_elementFarAway(): void { array_elementFarAway[40] = 7; }
const array_elementVeryFarAway: number[] = [3, 1, 2];
function sumOf_array_elementVeryFarAway(): number { let t = 0; for (const x of array_elementVeryFarAway) t += x; return t; }
function eachOf_array_elementVeryFarAway(): number { let t = 0; array_elementVeryFarAway.forEach((x: number) => { t += x; }); return t; }
function plain_array_elementVeryFarAway(): string {
    const seen: string[] = [];
    seen.push(show(array_elementVeryFarAway.map((x: number) => x * 2)));
    seen.push(show(array_elementVeryFarAway.includes(99)));
    seen.push(show(array_elementVeryFarAway.join("-")));
    seen.push(show(array_elementVeryFarAway.some((x: number) => x > 50)));
    seen.push(show(array_elementVeryFarAway.length));
    seen.push(show([...array_elementVeryFarAway]));
    seen.push(show(sumOf_array_elementVeryFarAway()));
    seen.push(show(eachOf_array_elementVeryFarAway()));
    seen.push(show(array_elementVeryFarAway.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_elementVeryFarAway(): void { array_elementVeryFarAway[400000] = 7; array_elementVeryFarAway.length = 4; }
const array_elementDeleted: number[] = [3, 1, 2];
function sumOf_array_elementDeleted(): number { let t = 0; for (const x of array_elementDeleted) t += x; return t; }
function eachOf_array_elementDeleted(): number { let t = 0; array_elementDeleted.forEach((x: number) => { t += x; }); return t; }
function plain_array_elementDeleted(): string {
    const seen: string[] = [];
    seen.push(show(array_elementDeleted.map((x: number) => x * 2)));
    seen.push(show(array_elementDeleted.includes(99)));
    seen.push(show(array_elementDeleted.join("-")));
    seen.push(show(array_elementDeleted.some((x: number) => x > 50)));
    seen.push(show(array_elementDeleted.length));
    seen.push(show([...array_elementDeleted]));
    seen.push(show(sumOf_array_elementDeleted()));
    seen.push(show(eachOf_array_elementDeleted()));
    seen.push(show(array_elementDeleted.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_elementDeleted(): void { delete array_elementDeleted[1]; }
const array_elementByAStringKey: number[] = [3, 1, 2];
function sumOf_array_elementByAStringKey(): number { let t = 0; for (const x of array_elementByAStringKey) t += x; return t; }
function eachOf_array_elementByAStringKey(): number { let t = 0; array_elementByAStringKey.forEach((x: number) => { t += x; }); return t; }
function plain_array_elementByAStringKey(): string {
    const seen: string[] = [];
    seen.push(show(array_elementByAStringKey.map((x: number) => x * 2)));
    seen.push(show(array_elementByAStringKey.includes(99)));
    seen.push(show(array_elementByAStringKey.join("-")));
    seen.push(show(array_elementByAStringKey.some((x: number) => x > 50)));
    seen.push(show(array_elementByAStringKey.length));
    seen.push(show([...array_elementByAStringKey]));
    seen.push(show(sumOf_array_elementByAStringKey()));
    seen.push(show(eachOf_array_elementByAStringKey()));
    seen.push(show(array_elementByAStringKey.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_elementByAStringKey(): void { const k: string = yes ? "1" : "x"; (array_elementByAStringKey as any)[k] = 8; }
const array_pushed: number[] = [3, 1, 2];
function sumOf_array_pushed(): number { let t = 0; for (const x of array_pushed) t += x; return t; }
function eachOf_array_pushed(): number { let t = 0; array_pushed.forEach((x: number) => { t += x; }); return t; }
function plain_array_pushed(): string {
    const seen: string[] = [];
    seen.push(show(array_pushed.map((x: number) => x * 2)));
    seen.push(show(array_pushed.includes(99)));
    seen.push(show(array_pushed.join("-")));
    seen.push(show(array_pushed.some((x: number) => x > 50)));
    seen.push(show(array_pushed.length));
    seen.push(show([...array_pushed]));
    seen.push(show(sumOf_array_pushed()));
    seen.push(show(eachOf_array_pushed()));
    seen.push(show(array_pushed.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_pushed(): void { array_pushed.push(5); array_pushed.push(6, 7); }
const array_popped: number[] = [3, 1, 2];
function sumOf_array_popped(): number { let t = 0; for (const x of array_popped) t += x; return t; }
function eachOf_array_popped(): number { let t = 0; array_popped.forEach((x: number) => { t += x; }); return t; }
function plain_array_popped(): string {
    const seen: string[] = [];
    seen.push(show(array_popped.map((x: number) => x * 2)));
    seen.push(show(array_popped.includes(99)));
    seen.push(show(array_popped.join("-")));
    seen.push(show(array_popped.some((x: number) => x > 50)));
    seen.push(show(array_popped.length));
    seen.push(show([...array_popped]));
    seen.push(show(sumOf_array_popped()));
    seen.push(show(eachOf_array_popped()));
    seen.push(show(array_popped.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_popped(): void { array_popped.pop(); array_popped.shift(); array_popped.unshift(8); }
const array_spliced: number[] = [3, 1, 2];
function sumOf_array_spliced(): number { let t = 0; for (const x of array_spliced) t += x; return t; }
function eachOf_array_spliced(): number { let t = 0; array_spliced.forEach((x: number) => { t += x; }); return t; }
function plain_array_spliced(): string {
    const seen: string[] = [];
    seen.push(show(array_spliced.map((x: number) => x * 2)));
    seen.push(show(array_spliced.includes(99)));
    seen.push(show(array_spliced.join("-")));
    seen.push(show(array_spliced.some((x: number) => x > 50)));
    seen.push(show(array_spliced.length));
    seen.push(show([...array_spliced]));
    seen.push(show(sumOf_array_spliced()));
    seen.push(show(eachOf_array_spliced()));
    seen.push(show(array_spliced.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_spliced(): void { array_spliced.splice(1, 1, 6, 6); }
const map_cleared: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_cleared(): number { let t = 0; for (const [k, v] of map_cleared) t += v + k.length; return t; }
function eachOf_map_cleared(): number { let t = 0; map_cleared.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_cleared(): string {
    const seen: string[] = [];
    seen.push(show(map_cleared.get("a")));
    seen.push(show(map_cleared.has("zz")));
    seen.push(show(map_cleared.size));
    seen.push(show([...map_cleared.keys()]));
    seen.push(show(sumOf_map_cleared()));
    seen.push(show(eachOf_map_cleared()));
    return seen.join(" ");
}
function meddle_map_cleared(): void { map_cleared.clear(); }
const set_cleared: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_cleared(): number { let t = 0; for (const k of set_cleared) t += k.length; return t; }
function eachOf_set_cleared(): number { let t = 0; set_cleared.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_cleared(): string {
    const seen: string[] = [];
    seen.push(show(set_cleared.has("zz")));
    seen.push(show(set_cleared.size));
    seen.push(show([...set_cleared]));
    seen.push(show(sumOf_set_cleared()));
    seen.push(show(eachOf_set_cleared()));
    return seen.join(" ");
}
function meddle_set_cleared(): void { set_cleared.clear(); }
const array_concatSpreadable: number[] = [3, 1, 2];
function sumOf_array_concatSpreadable(): number { let t = 0; for (const x of array_concatSpreadable) t += x; return t; }
function eachOf_array_concatSpreadable(): number { let t = 0; array_concatSpreadable.forEach((x: number) => { t += x; }); return t; }
function plain_array_concatSpreadable(): string {
    const seen: string[] = [];
    seen.push(show(array_concatSpreadable.map((x: number) => x * 2)));
    seen.push(show(array_concatSpreadable.includes(99)));
    seen.push(show(array_concatSpreadable.join("-")));
    seen.push(show(array_concatSpreadable.some((x: number) => x > 50)));
    seen.push(show(array_concatSpreadable.length));
    seen.push(show([...array_concatSpreadable]));
    seen.push(show(sumOf_array_concatSpreadable()));
    seen.push(show(eachOf_array_concatSpreadable()));
    seen.push(show(array_concatSpreadable.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_concatSpreadable(): void { (array_concatSpreadable as any)[Symbol.isConcatSpreadable] = false; marks += [0].concat(array_concatSpreadable as any).length; }
const array_iteratorKept: number[] = [3, 1, 2];
function sumOf_array_iteratorKept(): number { let t = 0; for (const x of array_iteratorKept) t += x; return t; }
function eachOf_array_iteratorKept(): number { let t = 0; array_iteratorKept.forEach((x: number) => { t += x; }); return t; }
function plain_array_iteratorKept(): string {
    const seen: string[] = [];
    seen.push(show(array_iteratorKept.map((x: number) => x * 2)));
    seen.push(show(array_iteratorKept.includes(99)));
    seen.push(show(array_iteratorKept.join("-")));
    seen.push(show(array_iteratorKept.some((x: number) => x > 50)));
    seen.push(show(array_iteratorKept.length));
    seen.push(show([...array_iteratorKept]));
    seen.push(show(sumOf_array_iteratorKept()));
    seen.push(show(eachOf_array_iteratorKept()));
    seen.push(show(array_iteratorKept.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_iteratorKept(): void { holder.it = array_iteratorKept.keys(); marks += [...holder.it].length; }
const map_iteratorKept: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_iteratorKept(): number { let t = 0; for (const [k, v] of map_iteratorKept) t += v + k.length; return t; }
function eachOf_map_iteratorKept(): number { let t = 0; map_iteratorKept.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_iteratorKept(): string {
    const seen: string[] = [];
    seen.push(show(map_iteratorKept.get("a")));
    seen.push(show(map_iteratorKept.has("zz")));
    seen.push(show(map_iteratorKept.size));
    seen.push(show([...map_iteratorKept.keys()]));
    seen.push(show(sumOf_map_iteratorKept()));
    seen.push(show(eachOf_map_iteratorKept()));
    return seen.join(" ");
}
function meddle_map_iteratorKept(): void { holder.it = map_iteratorKept.keys(); marks += [...holder.it].length; }
const set_iteratorKept: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_iteratorKept(): number { let t = 0; for (const k of set_iteratorKept) t += k.length; return t; }
function eachOf_set_iteratorKept(): number { let t = 0; set_iteratorKept.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_iteratorKept(): string {
    const seen: string[] = [];
    seen.push(show(set_iteratorKept.has("zz")));
    seen.push(show(set_iteratorKept.size));
    seen.push(show([...set_iteratorKept]));
    seen.push(show(sumOf_set_iteratorKept()));
    seen.push(show(eachOf_set_iteratorKept()));
    return seen.join(" ");
}
function meddle_set_iteratorKept(): void { holder.it = set_iteratorKept.keys(); marks += [...holder.it].length; }
const array_handedToABuiltin: number[] = [3, 1, 2];
function sumOf_array_handedToABuiltin(): number { let t = 0; for (const x of array_handedToABuiltin) t += x; return t; }
function eachOf_array_handedToABuiltin(): number { let t = 0; array_handedToABuiltin.forEach((x: number) => { t += x; }); return t; }
function plain_array_handedToABuiltin(): string {
    const seen: string[] = [];
    seen.push(show(array_handedToABuiltin.map((x: number) => x * 2)));
    seen.push(show(array_handedToABuiltin.includes(99)));
    seen.push(show(array_handedToABuiltin.join("-")));
    seen.push(show(array_handedToABuiltin.some((x: number) => x > 50)));
    seen.push(show(array_handedToABuiltin.length));
    seen.push(show([...array_handedToABuiltin]));
    seen.push(show(sumOf_array_handedToABuiltin()));
    seen.push(show(eachOf_array_handedToABuiltin()));
    seen.push(show(array_handedToABuiltin.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_handedToABuiltin(): void { marks += Array.from(array_handedToABuiltin).length + Object.keys(array_handedToABuiltin).length; }
const map_handedToABuiltin: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_handedToABuiltin(): number { let t = 0; for (const [k, v] of map_handedToABuiltin) t += v + k.length; return t; }
function eachOf_map_handedToABuiltin(): number { let t = 0; map_handedToABuiltin.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_handedToABuiltin(): string {
    const seen: string[] = [];
    seen.push(show(map_handedToABuiltin.get("a")));
    seen.push(show(map_handedToABuiltin.has("zz")));
    seen.push(show(map_handedToABuiltin.size));
    seen.push(show([...map_handedToABuiltin.keys()]));
    seen.push(show(sumOf_map_handedToABuiltin()));
    seen.push(show(eachOf_map_handedToABuiltin()));
    return seen.join(" ");
}
function meddle_map_handedToABuiltin(): void { marks += Array.from(map_handedToABuiltin).length + Object.keys(map_handedToABuiltin).length; }
const set_handedToABuiltin: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_handedToABuiltin(): number { let t = 0; for (const k of set_handedToABuiltin) t += k.length; return t; }
function eachOf_set_handedToABuiltin(): number { let t = 0; set_handedToABuiltin.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_handedToABuiltin(): string {
    const seen: string[] = [];
    seen.push(show(set_handedToABuiltin.has("zz")));
    seen.push(show(set_handedToABuiltin.size));
    seen.push(show([...set_handedToABuiltin]));
    seen.push(show(sumOf_set_handedToABuiltin()));
    seen.push(show(eachOf_set_handedToABuiltin()));
    return seen.join(" ");
}
function meddle_set_handedToABuiltin(): void { marks += Array.from(set_handedToABuiltin).length + Object.keys(set_handedToABuiltin).length; }
const array_handedToAConstructor: number[] = [3, 1, 2];
function sumOf_array_handedToAConstructor(): number { let t = 0; for (const x of array_handedToAConstructor) t += x; return t; }
function eachOf_array_handedToAConstructor(): number { let t = 0; array_handedToAConstructor.forEach((x: number) => { t += x; }); return t; }
function plain_array_handedToAConstructor(): string {
    const seen: string[] = [];
    seen.push(show(array_handedToAConstructor.map((x: number) => x * 2)));
    seen.push(show(array_handedToAConstructor.includes(99)));
    seen.push(show(array_handedToAConstructor.join("-")));
    seen.push(show(array_handedToAConstructor.some((x: number) => x > 50)));
    seen.push(show(array_handedToAConstructor.length));
    seen.push(show([...array_handedToAConstructor]));
    seen.push(show(sumOf_array_handedToAConstructor()));
    seen.push(show(eachOf_array_handedToAConstructor()));
    seen.push(show(array_handedToAConstructor.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_handedToAConstructor(): void { marks += new Set<any>(array_handedToAConstructor).size; }
const map_handedToAConstructor: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_handedToAConstructor(): number { let t = 0; for (const [k, v] of map_handedToAConstructor) t += v + k.length; return t; }
function eachOf_map_handedToAConstructor(): number { let t = 0; map_handedToAConstructor.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_handedToAConstructor(): string {
    const seen: string[] = [];
    seen.push(show(map_handedToAConstructor.get("a")));
    seen.push(show(map_handedToAConstructor.has("zz")));
    seen.push(show(map_handedToAConstructor.size));
    seen.push(show([...map_handedToAConstructor.keys()]));
    seen.push(show(sumOf_map_handedToAConstructor()));
    seen.push(show(eachOf_map_handedToAConstructor()));
    return seen.join(" ");
}
function meddle_map_handedToAConstructor(): void { marks += new Set<any>(map_handedToAConstructor).size; }
const set_handedToAConstructor: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_handedToAConstructor(): number { let t = 0; for (const k of set_handedToAConstructor) t += k.length; return t; }
function eachOf_set_handedToAConstructor(): number { let t = 0; set_handedToAConstructor.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_handedToAConstructor(): string {
    const seen: string[] = [];
    seen.push(show(set_handedToAConstructor.has("zz")));
    seen.push(show(set_handedToAConstructor.size));
    seen.push(show([...set_handedToAConstructor]));
    seen.push(show(sumOf_set_handedToAConstructor()));
    seen.push(show(eachOf_set_handedToAConstructor()));
    return seen.join(" ");
}
function meddle_set_handedToAConstructor(): void { marks += new Set<any>(set_handedToAConstructor).size; }
const array_structuredCloned: number[] = [3, 1, 2];
function sumOf_array_structuredCloned(): number { let t = 0; for (const x of array_structuredCloned) t += x; return t; }
function eachOf_array_structuredCloned(): number { let t = 0; array_structuredCloned.forEach((x: number) => { t += x; }); return t; }
function plain_array_structuredCloned(): string {
    const seen: string[] = [];
    seen.push(show(array_structuredCloned.map((x: number) => x * 2)));
    seen.push(show(array_structuredCloned.includes(99)));
    seen.push(show(array_structuredCloned.join("-")));
    seen.push(show(array_structuredCloned.some((x: number) => x > 50)));
    seen.push(show(array_structuredCloned.length));
    seen.push(show([...array_structuredCloned]));
    seen.push(show(sumOf_array_structuredCloned()));
    seen.push(show(eachOf_array_structuredCloned()));
    seen.push(show(array_structuredCloned.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_structuredCloned(): void { alter(structuredClone(array_structuredCloned)); }
const map_structuredCloned: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_structuredCloned(): number { let t = 0; for (const [k, v] of map_structuredCloned) t += v + k.length; return t; }
function eachOf_map_structuredCloned(): number { let t = 0; map_structuredCloned.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_structuredCloned(): string {
    const seen: string[] = [];
    seen.push(show(map_structuredCloned.get("a")));
    seen.push(show(map_structuredCloned.has("zz")));
    seen.push(show(map_structuredCloned.size));
    seen.push(show([...map_structuredCloned.keys()]));
    seen.push(show(sumOf_map_structuredCloned()));
    seen.push(show(eachOf_map_structuredCloned()));
    return seen.join(" ");
}
function meddle_map_structuredCloned(): void { alter(structuredClone(map_structuredCloned)); }
const set_structuredCloned: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_structuredCloned(): number { let t = 0; for (const k of set_structuredCloned) t += k.length; return t; }
function eachOf_set_structuredCloned(): number { let t = 0; set_structuredCloned.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_structuredCloned(): string {
    const seen: string[] = [];
    seen.push(show(set_structuredCloned.has("zz")));
    seen.push(show(set_structuredCloned.size));
    seen.push(show([...set_structuredCloned]));
    seen.push(show(sumOf_set_structuredCloned()));
    seen.push(show(eachOf_set_structuredCloned()));
    return seen.join(" ");
}
function meddle_set_structuredCloned(): void { alter(structuredClone(set_structuredCloned)); }
const array_awaited: number[] = [3, 1, 2];
function sumOf_array_awaited(): number { let t = 0; for (const x of array_awaited) t += x; return t; }
function eachOf_array_awaited(): number { let t = 0; array_awaited.forEach((x: number) => { t += x; }); return t; }
async function wait_array_awaited(): Promise<void> { alter(await array_awaited); }
function plain_array_awaited(): string {
    const seen: string[] = [];
    seen.push(show(array_awaited.map((x: number) => x * 2)));
    seen.push(show(array_awaited.includes(99)));
    seen.push(show(array_awaited.join("-")));
    seen.push(show(array_awaited.some((x: number) => x > 50)));
    seen.push(show(array_awaited.length));
    seen.push(show([...array_awaited]));
    seen.push(show(sumOf_array_awaited()));
    seen.push(show(eachOf_array_awaited()));
    seen.push(show(array_awaited.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_awaited(): void { void wait_array_awaited(); }
const map_awaited: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_awaited(): number { let t = 0; for (const [k, v] of map_awaited) t += v + k.length; return t; }
function eachOf_map_awaited(): number { let t = 0; map_awaited.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
async function wait_map_awaited(): Promise<void> { alter(await map_awaited); }
function plain_map_awaited(): string {
    const seen: string[] = [];
    seen.push(show(map_awaited.get("a")));
    seen.push(show(map_awaited.has("zz")));
    seen.push(show(map_awaited.size));
    seen.push(show([...map_awaited.keys()]));
    seen.push(show(sumOf_map_awaited()));
    seen.push(show(eachOf_map_awaited()));
    return seen.join(" ");
}
function meddle_map_awaited(): void { void wait_map_awaited(); }
const set_awaited: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_awaited(): number { let t = 0; for (const k of set_awaited) t += k.length; return t; }
function eachOf_set_awaited(): number { let t = 0; set_awaited.forEach((k: string) => { t += k.length; }); return t; }
async function wait_set_awaited(): Promise<void> { alter(await set_awaited); }
function plain_set_awaited(): string {
    const seen: string[] = [];
    seen.push(show(set_awaited.has("zz")));
    seen.push(show(set_awaited.size));
    seen.push(show([...set_awaited]));
    seen.push(show(sumOf_set_awaited()));
    seen.push(show(eachOf_set_awaited()));
    return seen.join(" ");
}
function meddle_set_awaited(): void { void wait_set_awaited(); }
const array_resolved: number[] = [3, 1, 2];
function sumOf_array_resolved(): number { let t = 0; for (const x of array_resolved) t += x; return t; }
function eachOf_array_resolved(): number { let t = 0; array_resolved.forEach((x: number) => { t += x; }); return t; }
function plain_array_resolved(): string {
    const seen: string[] = [];
    seen.push(show(array_resolved.map((x: number) => x * 2)));
    seen.push(show(array_resolved.includes(99)));
    seen.push(show(array_resolved.join("-")));
    seen.push(show(array_resolved.some((x: number) => x > 50)));
    seen.push(show(array_resolved.length));
    seen.push(show([...array_resolved]));
    seen.push(show(sumOf_array_resolved()));
    seen.push(show(eachOf_array_resolved()));
    seen.push(show(array_resolved.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_resolved(): void { void Promise.resolve(array_resolved).then(alter); }
const map_resolved: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_resolved(): number { let t = 0; for (const [k, v] of map_resolved) t += v + k.length; return t; }
function eachOf_map_resolved(): number { let t = 0; map_resolved.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_resolved(): string {
    const seen: string[] = [];
    seen.push(show(map_resolved.get("a")));
    seen.push(show(map_resolved.has("zz")));
    seen.push(show(map_resolved.size));
    seen.push(show([...map_resolved.keys()]));
    seen.push(show(sumOf_map_resolved()));
    seen.push(show(eachOf_map_resolved()));
    return seen.join(" ");
}
function meddle_map_resolved(): void { void Promise.resolve(map_resolved).then(alter); }
const set_resolved: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_resolved(): number { let t = 0; for (const k of set_resolved) t += k.length; return t; }
function eachOf_set_resolved(): number { let t = 0; set_resolved.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_resolved(): string {
    const seen: string[] = [];
    seen.push(show(set_resolved.has("zz")));
    seen.push(show(set_resolved.size));
    seen.push(show([...set_resolved]));
    seen.push(show(sumOf_set_resolved()));
    seen.push(show(eachOf_set_resolved()));
    return seen.join(" ");
}
function meddle_set_resolved(): void { void Promise.resolve(set_resolved).then(alter); }
const array_liveAcrossAnAwait: number[] = [3, 1, 2];
function sumOf_array_liveAcrossAnAwait(): number { let t = 0; for (const x of array_liveAcrossAnAwait) t += x; return t; }
function eachOf_array_liveAcrossAnAwait(): number { let t = 0; array_liveAcrossAnAwait.forEach((x: number) => { t += x; }); return t; }
async function across_array_liveAcrossAnAwait(): Promise<void> { const w = array_liveAcrossAnAwait; marks += w === undefined ? 1 : 0; await Promise.resolve(); marks += w === array_liveAcrossAnAwait ? 10 : 0; lines.push("_array_liveAcrossAnAwait across: " + show(w)); }
function plain_array_liveAcrossAnAwait(): string {
    const seen: string[] = [];
    seen.push(show(array_liveAcrossAnAwait.map((x: number) => x * 2)));
    seen.push(show(array_liveAcrossAnAwait.includes(99)));
    seen.push(show(array_liveAcrossAnAwait.join("-")));
    seen.push(show(array_liveAcrossAnAwait.some((x: number) => x > 50)));
    seen.push(show(array_liveAcrossAnAwait.length));
    seen.push(show([...array_liveAcrossAnAwait]));
    seen.push(show(sumOf_array_liveAcrossAnAwait()));
    seen.push(show(eachOf_array_liveAcrossAnAwait()));
    seen.push(show(array_liveAcrossAnAwait.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_liveAcrossAnAwait(): void { void across_array_liveAcrossAnAwait(); }
const map_liveAcrossAnAwait: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_liveAcrossAnAwait(): number { let t = 0; for (const [k, v] of map_liveAcrossAnAwait) t += v + k.length; return t; }
function eachOf_map_liveAcrossAnAwait(): number { let t = 0; map_liveAcrossAnAwait.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
async function across_map_liveAcrossAnAwait(): Promise<void> { const w = map_liveAcrossAnAwait; marks += w === undefined ? 1 : 0; await Promise.resolve(); marks += w === map_liveAcrossAnAwait ? 10 : 0; lines.push("_map_liveAcrossAnAwait across: " + show(w)); }
function plain_map_liveAcrossAnAwait(): string {
    const seen: string[] = [];
    seen.push(show(map_liveAcrossAnAwait.get("a")));
    seen.push(show(map_liveAcrossAnAwait.has("zz")));
    seen.push(show(map_liveAcrossAnAwait.size));
    seen.push(show([...map_liveAcrossAnAwait.keys()]));
    seen.push(show(sumOf_map_liveAcrossAnAwait()));
    seen.push(show(eachOf_map_liveAcrossAnAwait()));
    return seen.join(" ");
}
function meddle_map_liveAcrossAnAwait(): void { void across_map_liveAcrossAnAwait(); }
const set_liveAcrossAnAwait: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_liveAcrossAnAwait(): number { let t = 0; for (const k of set_liveAcrossAnAwait) t += k.length; return t; }
function eachOf_set_liveAcrossAnAwait(): number { let t = 0; set_liveAcrossAnAwait.forEach((k: string) => { t += k.length; }); return t; }
async function across_set_liveAcrossAnAwait(): Promise<void> { const w = set_liveAcrossAnAwait; marks += w === undefined ? 1 : 0; await Promise.resolve(); marks += w === set_liveAcrossAnAwait ? 10 : 0; lines.push("_set_liveAcrossAnAwait across: " + show(w)); }
function plain_set_liveAcrossAnAwait(): string {
    const seen: string[] = [];
    seen.push(show(set_liveAcrossAnAwait.has("zz")));
    seen.push(show(set_liveAcrossAnAwait.size));
    seen.push(show([...set_liveAcrossAnAwait]));
    seen.push(show(sumOf_set_liveAcrossAnAwait()));
    seen.push(show(eachOf_set_liveAcrossAnAwait()));
    return seen.join(" ");
}
function meddle_set_liveAcrossAnAwait(): void { void across_set_liveAcrossAnAwait(); }
const array_liveAcrossAnAwaitAndAlteredMeanwhile: number[] = [3, 1, 2];
function sumOf_array_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; for (const x of array_liveAcrossAnAwaitAndAlteredMeanwhile) t += x; return t; }
function eachOf_array_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; array_liveAcrossAnAwaitAndAlteredMeanwhile.forEach((x: number) => { t += x; }); return t; }
async function across_array_liveAcrossAnAwaitAndAlteredMeanwhile(): Promise<void> { const w = array_liveAcrossAnAwaitAndAlteredMeanwhile; holder.it = w; await Promise.resolve(); try { lines.push("_array_liveAcrossAnAwaitAndAlteredMeanwhile across: " + plain_array_liveAcrossAnAwaitAndAlteredMeanwhile()); } catch (e) { lines.push("_array_liveAcrossAnAwaitAndAlteredMeanwhile across: " + thrown(e)); } }
function plain_array_liveAcrossAnAwaitAndAlteredMeanwhile(): string {
    const seen: string[] = [];
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.map((x: number) => x * 2)));
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.includes(99)));
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.join("-")));
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.some((x: number) => x > 50)));
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.length));
    seen.push(show([...array_liveAcrossAnAwaitAndAlteredMeanwhile]));
    seen.push(show(sumOf_array_liveAcrossAnAwaitAndAlteredMeanwhile()));
    seen.push(show(eachOf_array_liveAcrossAnAwaitAndAlteredMeanwhile()));
    seen.push(show(array_liveAcrossAnAwaitAndAlteredMeanwhile.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_liveAcrossAnAwaitAndAlteredMeanwhile(): void { void across_array_liveAcrossAnAwaitAndAlteredMeanwhile(); alter(holder.it); }
const map_liveAcrossAnAwaitAndAlteredMeanwhile: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; for (const [k, v] of map_liveAcrossAnAwaitAndAlteredMeanwhile) t += v + k.length; return t; }
function eachOf_map_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; map_liveAcrossAnAwaitAndAlteredMeanwhile.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
async function across_map_liveAcrossAnAwaitAndAlteredMeanwhile(): Promise<void> { const w = map_liveAcrossAnAwaitAndAlteredMeanwhile; holder.it = w; await Promise.resolve(); try { lines.push("_map_liveAcrossAnAwaitAndAlteredMeanwhile across: " + plain_map_liveAcrossAnAwaitAndAlteredMeanwhile()); } catch (e) { lines.push("_map_liveAcrossAnAwaitAndAlteredMeanwhile across: " + thrown(e)); } }
function plain_map_liveAcrossAnAwaitAndAlteredMeanwhile(): string {
    const seen: string[] = [];
    seen.push(show(map_liveAcrossAnAwaitAndAlteredMeanwhile.get("a")));
    seen.push(show(map_liveAcrossAnAwaitAndAlteredMeanwhile.has("zz")));
    seen.push(show(map_liveAcrossAnAwaitAndAlteredMeanwhile.size));
    seen.push(show([...map_liveAcrossAnAwaitAndAlteredMeanwhile.keys()]));
    seen.push(show(sumOf_map_liveAcrossAnAwaitAndAlteredMeanwhile()));
    seen.push(show(eachOf_map_liveAcrossAnAwaitAndAlteredMeanwhile()));
    return seen.join(" ");
}
function meddle_map_liveAcrossAnAwaitAndAlteredMeanwhile(): void { void across_map_liveAcrossAnAwaitAndAlteredMeanwhile(); alter(holder.it); }
const set_liveAcrossAnAwaitAndAlteredMeanwhile: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; for (const k of set_liveAcrossAnAwaitAndAlteredMeanwhile) t += k.length; return t; }
function eachOf_set_liveAcrossAnAwaitAndAlteredMeanwhile(): number { let t = 0; set_liveAcrossAnAwaitAndAlteredMeanwhile.forEach((k: string) => { t += k.length; }); return t; }
async function across_set_liveAcrossAnAwaitAndAlteredMeanwhile(): Promise<void> { const w = set_liveAcrossAnAwaitAndAlteredMeanwhile; holder.it = w; await Promise.resolve(); try { lines.push("_set_liveAcrossAnAwaitAndAlteredMeanwhile across: " + plain_set_liveAcrossAnAwaitAndAlteredMeanwhile()); } catch (e) { lines.push("_set_liveAcrossAnAwaitAndAlteredMeanwhile across: " + thrown(e)); } }
function plain_set_liveAcrossAnAwaitAndAlteredMeanwhile(): string {
    const seen: string[] = [];
    seen.push(show(set_liveAcrossAnAwaitAndAlteredMeanwhile.has("zz")));
    seen.push(show(set_liveAcrossAnAwaitAndAlteredMeanwhile.size));
    seen.push(show([...set_liveAcrossAnAwaitAndAlteredMeanwhile]));
    seen.push(show(sumOf_set_liveAcrossAnAwaitAndAlteredMeanwhile()));
    seen.push(show(eachOf_set_liveAcrossAnAwaitAndAlteredMeanwhile()));
    return seen.join(" ");
}
function meddle_set_liveAcrossAnAwaitAndAlteredMeanwhile(): void { void across_set_liveAcrossAnAwaitAndAlteredMeanwhile(); alter(holder.it); }
const array_yielded: number[] = [3, 1, 2];
function sumOf_array_yielded(): number { let t = 0; for (const x of array_yielded) t += x; return t; }
function eachOf_array_yielded(): number { let t = 0; array_yielded.forEach((x: number) => { t += x; }); return t; }
function* yield_array_yielded(): Generator<number[]> { yield array_yielded; }
function plain_array_yielded(): string {
    const seen: string[] = [];
    seen.push(show(array_yielded.map((x: number) => x * 2)));
    seen.push(show(array_yielded.includes(99)));
    seen.push(show(array_yielded.join("-")));
    seen.push(show(array_yielded.some((x: number) => x > 50)));
    seen.push(show(array_yielded.length));
    seen.push(show([...array_yielded]));
    seen.push(show(sumOf_array_yielded()));
    seen.push(show(eachOf_array_yielded()));
    seen.push(show(array_yielded.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_yielded(): void { for (const x of yield_array_yielded()) alter(x); }
const map_yielded: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_yielded(): number { let t = 0; for (const [k, v] of map_yielded) t += v + k.length; return t; }
function eachOf_map_yielded(): number { let t = 0; map_yielded.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function* yield_map_yielded(): Generator<Map<string, number>> { yield map_yielded; }
function plain_map_yielded(): string {
    const seen: string[] = [];
    seen.push(show(map_yielded.get("a")));
    seen.push(show(map_yielded.has("zz")));
    seen.push(show(map_yielded.size));
    seen.push(show([...map_yielded.keys()]));
    seen.push(show(sumOf_map_yielded()));
    seen.push(show(eachOf_map_yielded()));
    return seen.join(" ");
}
function meddle_map_yielded(): void { for (const x of yield_map_yielded()) alter(x); }
const set_yielded: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_yielded(): number { let t = 0; for (const k of set_yielded) t += k.length; return t; }
function eachOf_set_yielded(): number { let t = 0; set_yielded.forEach((k: string) => { t += k.length; }); return t; }
function* yield_set_yielded(): Generator<Set<string>> { yield set_yielded; }
function plain_set_yielded(): string {
    const seen: string[] = [];
    seen.push(show(set_yielded.has("zz")));
    seen.push(show(set_yielded.size));
    seen.push(show([...set_yielded]));
    seen.push(show(sumOf_set_yielded()));
    seen.push(show(eachOf_set_yielded()));
    return seen.join(" ");
}
function meddle_set_yielded(): void { for (const x of yield_set_yielded()) alter(x); }
const array_inATemplate: number[] = [3, 1, 2];
function sumOf_array_inATemplate(): number { let t = 0; for (const x of array_inATemplate) t += x; return t; }
function eachOf_array_inATemplate(): number { let t = 0; array_inATemplate.forEach((x: number) => { t += x; }); return t; }
function plain_array_inATemplate(): string {
    const seen: string[] = [];
    seen.push(show(array_inATemplate.map((x: number) => x * 2)));
    seen.push(show(array_inATemplate.includes(99)));
    seen.push(show(array_inATemplate.join("-")));
    seen.push(show(array_inATemplate.some((x: number) => x > 50)));
    seen.push(show(array_inATemplate.length));
    seen.push(show([...array_inATemplate]));
    seen.push(show(sumOf_array_inATemplate()));
    seen.push(show(eachOf_array_inATemplate()));
    seen.push(show(array_inATemplate.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_inATemplate(): void { marks += `${array_inATemplate}`.length; }
const array_compared: number[] = [3, 1, 2];
function sumOf_array_compared(): number { let t = 0; for (const x of array_compared) t += x; return t; }
function eachOf_array_compared(): number { let t = 0; array_compared.forEach((x: number) => { t += x; }); return t; }
function plain_array_compared(): string {
    const seen: string[] = [];
    seen.push(show(array_compared.map((x: number) => x * 2)));
    seen.push(show(array_compared.includes(99)));
    seen.push(show(array_compared.join("-")));
    seen.push(show(array_compared.some((x: number) => x > 50)));
    seen.push(show(array_compared.length));
    seen.push(show([...array_compared]));
    seen.push(show(sumOf_array_compared()));
    seen.push(show(eachOf_array_compared()));
    seen.push(show(array_compared.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_compared(): void { marks += (array_compared as any) == holder ? 1 : 0; marks += (array_compared as any) === holder ? 1 : 0; }
const map_compared: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_compared(): number { let t = 0; for (const [k, v] of map_compared) t += v + k.length; return t; }
function eachOf_map_compared(): number { let t = 0; map_compared.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_compared(): string {
    const seen: string[] = [];
    seen.push(show(map_compared.get("a")));
    seen.push(show(map_compared.has("zz")));
    seen.push(show(map_compared.size));
    seen.push(show([...map_compared.keys()]));
    seen.push(show(sumOf_map_compared()));
    seen.push(show(eachOf_map_compared()));
    return seen.join(" ");
}
function meddle_map_compared(): void { marks += (map_compared as any) == holder ? 1 : 0; marks += (map_compared as any) === holder ? 1 : 0; }
const set_compared: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_compared(): number { let t = 0; for (const k of set_compared) t += k.length; return t; }
function eachOf_set_compared(): number { let t = 0; set_compared.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_compared(): string {
    const seen: string[] = [];
    seen.push(show(set_compared.has("zz")));
    seen.push(show(set_compared.size));
    seen.push(show([...set_compared]));
    seen.push(show(sumOf_set_compared()));
    seen.push(show(eachOf_set_compared()));
    return seen.join(" ");
}
function meddle_set_compared(): void { marks += (set_compared as any) == holder ? 1 : 0; marks += (set_compared as any) === holder ? 1 : 0; }
const array_instanceOfAClassWithHasInstance: number[] = [3, 1, 2];
function sumOf_array_instanceOfAClassWithHasInstance(): number { let t = 0; for (const x of array_instanceOfAClassWithHasInstance) t += x; return t; }
function eachOf_array_instanceOfAClassWithHasInstance(): number { let t = 0; array_instanceOfAClassWithHasInstance.forEach((x: number) => { t += x; }); return t; }
class Sees_array_instanceOfAClassWithHasInstance { static [Symbol.hasInstance](x: any): boolean { alter(x); return false; } }
function plain_array_instanceOfAClassWithHasInstance(): string {
    const seen: string[] = [];
    seen.push(show(array_instanceOfAClassWithHasInstance.map((x: number) => x * 2)));
    seen.push(show(array_instanceOfAClassWithHasInstance.includes(99)));
    seen.push(show(array_instanceOfAClassWithHasInstance.join("-")));
    seen.push(show(array_instanceOfAClassWithHasInstance.some((x: number) => x > 50)));
    seen.push(show(array_instanceOfAClassWithHasInstance.length));
    seen.push(show([...array_instanceOfAClassWithHasInstance]));
    seen.push(show(sumOf_array_instanceOfAClassWithHasInstance()));
    seen.push(show(eachOf_array_instanceOfAClassWithHasInstance()));
    seen.push(show(array_instanceOfAClassWithHasInstance.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_instanceOfAClassWithHasInstance(): void { marks += (array_instanceOfAClassWithHasInstance as any) instanceof Sees_array_instanceOfAClassWithHasInstance ? 1 : 0; }
const map_instanceOfAClassWithHasInstance: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_instanceOfAClassWithHasInstance(): number { let t = 0; for (const [k, v] of map_instanceOfAClassWithHasInstance) t += v + k.length; return t; }
function eachOf_map_instanceOfAClassWithHasInstance(): number { let t = 0; map_instanceOfAClassWithHasInstance.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
class Sees_map_instanceOfAClassWithHasInstance { static [Symbol.hasInstance](x: any): boolean { alter(x); return false; } }
function plain_map_instanceOfAClassWithHasInstance(): string {
    const seen: string[] = [];
    seen.push(show(map_instanceOfAClassWithHasInstance.get("a")));
    seen.push(show(map_instanceOfAClassWithHasInstance.has("zz")));
    seen.push(show(map_instanceOfAClassWithHasInstance.size));
    seen.push(show([...map_instanceOfAClassWithHasInstance.keys()]));
    seen.push(show(sumOf_map_instanceOfAClassWithHasInstance()));
    seen.push(show(eachOf_map_instanceOfAClassWithHasInstance()));
    return seen.join(" ");
}
function meddle_map_instanceOfAClassWithHasInstance(): void { marks += (map_instanceOfAClassWithHasInstance as any) instanceof Sees_map_instanceOfAClassWithHasInstance ? 1 : 0; }
const set_instanceOfAClassWithHasInstance: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_instanceOfAClassWithHasInstance(): number { let t = 0; for (const k of set_instanceOfAClassWithHasInstance) t += k.length; return t; }
function eachOf_set_instanceOfAClassWithHasInstance(): number { let t = 0; set_instanceOfAClassWithHasInstance.forEach((k: string) => { t += k.length; }); return t; }
class Sees_set_instanceOfAClassWithHasInstance { static [Symbol.hasInstance](x: any): boolean { alter(x); return false; } }
function plain_set_instanceOfAClassWithHasInstance(): string {
    const seen: string[] = [];
    seen.push(show(set_instanceOfAClassWithHasInstance.has("zz")));
    seen.push(show(set_instanceOfAClassWithHasInstance.size));
    seen.push(show([...set_instanceOfAClassWithHasInstance]));
    seen.push(show(sumOf_set_instanceOfAClassWithHasInstance()));
    seen.push(show(eachOf_set_instanceOfAClassWithHasInstance()));
    return seen.join(" ");
}
function meddle_set_instanceOfAClassWithHasInstance(): void { marks += (set_instanceOfAClassWithHasInstance as any) instanceof Sees_set_instanceOfAClassWithHasInstance ? 1 : 0; }
const array_keyOfAWeakMap: number[] = [3, 1, 2];
function sumOf_array_keyOfAWeakMap(): number { let t = 0; for (const x of array_keyOfAWeakMap) t += x; return t; }
function eachOf_array_keyOfAWeakMap(): number { let t = 0; array_keyOfAWeakMap.forEach((x: number) => { t += x; }); return t; }
function plain_array_keyOfAWeakMap(): string {
    const seen: string[] = [];
    seen.push(show(array_keyOfAWeakMap.map((x: number) => x * 2)));
    seen.push(show(array_keyOfAWeakMap.includes(99)));
    seen.push(show(array_keyOfAWeakMap.join("-")));
    seen.push(show(array_keyOfAWeakMap.some((x: number) => x > 50)));
    seen.push(show(array_keyOfAWeakMap.length));
    seen.push(show([...array_keyOfAWeakMap]));
    seen.push(show(sumOf_array_keyOfAWeakMap()));
    seen.push(show(eachOf_array_keyOfAWeakMap()));
    seen.push(show(array_keyOfAWeakMap.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_keyOfAWeakMap(): void { const w = new WeakMap<object, number>(); w.set(array_keyOfAWeakMap, 1); marks += w.get(array_keyOfAWeakMap) ?? 0; }
const map_keyOfAWeakMap: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_keyOfAWeakMap(): number { let t = 0; for (const [k, v] of map_keyOfAWeakMap) t += v + k.length; return t; }
function eachOf_map_keyOfAWeakMap(): number { let t = 0; map_keyOfAWeakMap.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_keyOfAWeakMap(): string {
    const seen: string[] = [];
    seen.push(show(map_keyOfAWeakMap.get("a")));
    seen.push(show(map_keyOfAWeakMap.has("zz")));
    seen.push(show(map_keyOfAWeakMap.size));
    seen.push(show([...map_keyOfAWeakMap.keys()]));
    seen.push(show(sumOf_map_keyOfAWeakMap()));
    seen.push(show(eachOf_map_keyOfAWeakMap()));
    return seen.join(" ");
}
function meddle_map_keyOfAWeakMap(): void { const w = new WeakMap<object, number>(); w.set(map_keyOfAWeakMap, 1); marks += w.get(map_keyOfAWeakMap) ?? 0; }
const set_keyOfAWeakMap: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_keyOfAWeakMap(): number { let t = 0; for (const k of set_keyOfAWeakMap) t += k.length; return t; }
function eachOf_set_keyOfAWeakMap(): number { let t = 0; set_keyOfAWeakMap.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_keyOfAWeakMap(): string {
    const seen: string[] = [];
    seen.push(show(set_keyOfAWeakMap.has("zz")));
    seen.push(show(set_keyOfAWeakMap.size));
    seen.push(show([...set_keyOfAWeakMap]));
    seen.push(show(sumOf_set_keyOfAWeakMap()));
    seen.push(show(eachOf_set_keyOfAWeakMap()));
    return seen.join(" ");
}
function meddle_set_keyOfAWeakMap(): void { const w = new WeakMap<object, number>(); w.set(set_keyOfAWeakMap, 1); marks += w.get(set_keyOfAWeakMap) ?? 0; }
const array_valueOfAMap: number[] = [3, 1, 2];
function sumOf_array_valueOfAMap(): number { let t = 0; for (const x of array_valueOfAMap) t += x; return t; }
function eachOf_array_valueOfAMap(): number { let t = 0; array_valueOfAMap.forEach((x: number) => { t += x; }); return t; }
function plain_array_valueOfAMap(): string {
    const seen: string[] = [];
    seen.push(show(array_valueOfAMap.map((x: number) => x * 2)));
    seen.push(show(array_valueOfAMap.includes(99)));
    seen.push(show(array_valueOfAMap.join("-")));
    seen.push(show(array_valueOfAMap.some((x: number) => x > 50)));
    seen.push(show(array_valueOfAMap.length));
    seen.push(show([...array_valueOfAMap]));
    seen.push(show(sumOf_array_valueOfAMap()));
    seen.push(show(eachOf_array_valueOfAMap()));
    seen.push(show(array_valueOfAMap.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_valueOfAMap(): void { const m = new Map<string, any>(); m.set("v", array_valueOfAMap); alter(m.get("v")); }
const map_valueOfAMap: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_valueOfAMap(): number { let t = 0; for (const [k, v] of map_valueOfAMap) t += v + k.length; return t; }
function eachOf_map_valueOfAMap(): number { let t = 0; map_valueOfAMap.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_valueOfAMap(): string {
    const seen: string[] = [];
    seen.push(show(map_valueOfAMap.get("a")));
    seen.push(show(map_valueOfAMap.has("zz")));
    seen.push(show(map_valueOfAMap.size));
    seen.push(show([...map_valueOfAMap.keys()]));
    seen.push(show(sumOf_map_valueOfAMap()));
    seen.push(show(eachOf_map_valueOfAMap()));
    return seen.join(" ");
}
function meddle_map_valueOfAMap(): void { const m = new Map<string, any>(); m.set("v", map_valueOfAMap); alter(m.get("v")); }
const set_valueOfAMap: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_valueOfAMap(): number { let t = 0; for (const k of set_valueOfAMap) t += k.length; return t; }
function eachOf_set_valueOfAMap(): number { let t = 0; set_valueOfAMap.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_valueOfAMap(): string {
    const seen: string[] = [];
    seen.push(show(set_valueOfAMap.has("zz")));
    seen.push(show(set_valueOfAMap.size));
    seen.push(show([...set_valueOfAMap]));
    seen.push(show(sumOf_set_valueOfAMap()));
    seen.push(show(eachOf_set_valueOfAMap()));
    return seen.join(" ");
}
function meddle_set_valueOfAMap(): void { const m = new Map<string, any>(); m.set("v", set_valueOfAMap); alter(m.get("v")); }
const array_elementOfAnArray: number[] = [3, 1, 2];
function sumOf_array_elementOfAnArray(): number { let t = 0; for (const x of array_elementOfAnArray) t += x; return t; }
function eachOf_array_elementOfAnArray(): number { let t = 0; array_elementOfAnArray.forEach((x: number) => { t += x; }); return t; }
function plain_array_elementOfAnArray(): string {
    const seen: string[] = [];
    seen.push(show(array_elementOfAnArray.map((x: number) => x * 2)));
    seen.push(show(array_elementOfAnArray.includes(99)));
    seen.push(show(array_elementOfAnArray.join("-")));
    seen.push(show(array_elementOfAnArray.some((x: number) => x > 50)));
    seen.push(show(array_elementOfAnArray.length));
    seen.push(show([...array_elementOfAnArray]));
    seen.push(show(sumOf_array_elementOfAnArray()));
    seen.push(show(eachOf_array_elementOfAnArray()));
    seen.push(show(array_elementOfAnArray.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_elementOfAnArray(): void { const a: any[] = []; a.push(array_elementOfAnArray); alter(a[0]); }
const map_elementOfAnArray: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_elementOfAnArray(): number { let t = 0; for (const [k, v] of map_elementOfAnArray) t += v + k.length; return t; }
function eachOf_map_elementOfAnArray(): number { let t = 0; map_elementOfAnArray.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_elementOfAnArray(): string {
    const seen: string[] = [];
    seen.push(show(map_elementOfAnArray.get("a")));
    seen.push(show(map_elementOfAnArray.has("zz")));
    seen.push(show(map_elementOfAnArray.size));
    seen.push(show([...map_elementOfAnArray.keys()]));
    seen.push(show(sumOf_map_elementOfAnArray()));
    seen.push(show(eachOf_map_elementOfAnArray()));
    return seen.join(" ");
}
function meddle_map_elementOfAnArray(): void { const a: any[] = []; a.push(map_elementOfAnArray); alter(a[0]); }
const set_elementOfAnArray: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_elementOfAnArray(): number { let t = 0; for (const k of set_elementOfAnArray) t += k.length; return t; }
function eachOf_set_elementOfAnArray(): number { let t = 0; set_elementOfAnArray.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_elementOfAnArray(): string {
    const seen: string[] = [];
    seen.push(show(set_elementOfAnArray.has("zz")));
    seen.push(show(set_elementOfAnArray.size));
    seen.push(show([...set_elementOfAnArray]));
    seen.push(show(sumOf_set_elementOfAnArray()));
    seen.push(show(eachOf_set_elementOfAnArray()));
    return seen.join(" ");
}
function meddle_set_elementOfAnArray(): void { const a: any[] = []; a.push(set_elementOfAnArray); alter(a[0]); }
const array_globalThisProperty: number[] = [3, 1, 2];
function sumOf_array_globalThisProperty(): number { let t = 0; for (const x of array_globalThisProperty) t += x; return t; }
function eachOf_array_globalThisProperty(): number { let t = 0; array_globalThisProperty.forEach((x: number) => { t += x; }); return t; }
function plain_array_globalThisProperty(): string {
    const seen: string[] = [];
    seen.push(show(array_globalThisProperty.map((x: number) => x * 2)));
    seen.push(show(array_globalThisProperty.includes(99)));
    seen.push(show(array_globalThisProperty.join("-")));
    seen.push(show(array_globalThisProperty.some((x: number) => x > 50)));
    seen.push(show(array_globalThisProperty.length));
    seen.push(show([...array_globalThisProperty]));
    seen.push(show(sumOf_array_globalThisProperty()));
    seen.push(show(eachOf_array_globalThisProperty()));
    seen.push(show(array_globalThisProperty.filter(isLarge)));
    return seen.join(" ");
}
function meddle_array_globalThisProperty(): void { (globalThis as any).leaked_array_globalThisProperty = array_globalThisProperty; alter((globalThis as any).leaked_array_globalThisProperty); }
const map_globalThisProperty: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
function sumOf_map_globalThisProperty(): number { let t = 0; for (const [k, v] of map_globalThisProperty) t += v + k.length; return t; }
function eachOf_map_globalThisProperty(): number { let t = 0; map_globalThisProperty.forEach((v: number, k: string) => { t += v + k.length; }); return t; }
function plain_map_globalThisProperty(): string {
    const seen: string[] = [];
    seen.push(show(map_globalThisProperty.get("a")));
    seen.push(show(map_globalThisProperty.has("zz")));
    seen.push(show(map_globalThisProperty.size));
    seen.push(show([...map_globalThisProperty.keys()]));
    seen.push(show(sumOf_map_globalThisProperty()));
    seen.push(show(eachOf_map_globalThisProperty()));
    return seen.join(" ");
}
function meddle_map_globalThisProperty(): void { (globalThis as any).leaked_map_globalThisProperty = map_globalThisProperty; alter((globalThis as any).leaked_map_globalThisProperty); }
const set_globalThisProperty: Set<string> = new Set<string>(["a", "b"]);
function sumOf_set_globalThisProperty(): number { let t = 0; for (const k of set_globalThisProperty) t += k.length; return t; }
function eachOf_set_globalThisProperty(): number { let t = 0; set_globalThisProperty.forEach((k: string) => { t += k.length; }); return t; }
function plain_set_globalThisProperty(): string {
    const seen: string[] = [];
    seen.push(show(set_globalThisProperty.has("zz")));
    seen.push(show(set_globalThisProperty.size));
    seen.push(show([...set_globalThisProperty]));
    seen.push(show(sumOf_set_globalThisProperty()));
    seen.push(show(eachOf_set_globalThisProperty()));
    return seen.join(" ");
}
function meddle_set_globalThisProperty(): void { (globalThis as any).leaked_set_globalThisProperty = set_globalThisProperty; alter((globalThis as any).leaked_set_globalThisProperty); }
report("array_nothing", plain_array_nothing, plain_array_nothing, meddle_array_nothing);
report("map_nothing", plain_map_nothing, plain_map_nothing, meddle_map_nothing);
report("set_nothing", plain_set_nothing, plain_set_nothing, meddle_set_nothing);
report("array_onlyRead", plain_array_onlyRead, plain_array_onlyRead, meddle_array_onlyRead);
report("map_onlyRead", plain_map_onlyRead, plain_map_onlyRead, meddle_map_onlyRead);
report("set_onlyRead", plain_set_onlyRead, plain_set_onlyRead, meddle_set_onlyRead);
report("array_ownMethod", plain_array_ownMethod, plain_array_ownMethod, meddle_array_ownMethod);
report("map_ownMethod", plain_map_ownMethod, plain_map_ownMethod, meddle_map_ownMethod);
report("set_ownMethod", plain_set_ownMethod, plain_set_ownMethod, meddle_set_ownMethod);
report("array_ownMethodByKey", plain_array_ownMethodByKey, plain_array_ownMethodByKey, meddle_array_ownMethodByKey);
report("map_ownMethodByKey", plain_map_ownMethodByKey, plain_map_ownMethodByKey, meddle_map_ownMethodByKey);
report("set_ownMethodByKey", plain_set_ownMethodByKey, plain_set_ownMethodByKey, meddle_set_ownMethodByKey);
report("array_handedToFunction", plain_array_handedToFunction, plain_array_handedToFunction, meddle_array_handedToFunction);
report("map_handedToFunction", plain_map_handedToFunction, plain_map_handedToFunction, meddle_map_handedToFunction);
report("set_handedToFunction", plain_set_handedToFunction, plain_set_handedToFunction, meddle_set_handedToFunction);
report("array_handedOnOneRoad", plain_array_handedOnOneRoad, plain_array_handedOnOneRoad, meddle_array_handedOnOneRoad);
report("map_handedOnOneRoad", plain_map_handedOnOneRoad, plain_map_handedOnOneRoad, meddle_map_handedOnOneRoad);
report("set_handedOnOneRoad", plain_set_handedOnOneRoad, plain_set_handedOnOneRoad, meddle_set_handedOnOneRoad);
report("array_handedOnARoadNotTaken", plain_array_handedOnARoadNotTaken, plain_array_handedOnARoadNotTaken, meddle_array_handedOnARoadNotTaken);
report("map_handedOnARoadNotTaken", plain_map_handedOnARoadNotTaken, plain_map_handedOnARoadNotTaken, meddle_map_handedOnARoadNotTaken);
report("set_handedOnARoadNotTaken", plain_set_handedOnARoadNotTaken, plain_set_handedOnARoadNotTaken, meddle_set_handedOnARoadNotTaken);
report("array_throughIdentity", plain_array_throughIdentity, plain_array_throughIdentity, meddle_array_throughIdentity);
report("map_throughIdentity", plain_map_throughIdentity, plain_map_throughIdentity, meddle_map_throughIdentity);
report("set_throughIdentity", plain_set_throughIdentity, plain_set_throughIdentity, meddle_set_throughIdentity);
report("array_throughAField", plain_array_throughAField, plain_array_throughAField, meddle_array_throughAField);
report("map_throughAField", plain_map_throughAField, plain_map_throughAField, meddle_map_throughAField);
report("set_throughAField", plain_set_throughAField, plain_set_throughAField, meddle_set_throughAField);
report("array_throughAnotherVariable", plain_array_throughAnotherVariable, plain_array_throughAnotherVariable, meddle_array_throughAnotherVariable);
report("map_throughAnotherVariable", plain_map_throughAnotherVariable, plain_map_throughAnotherVariable, meddle_map_throughAnotherVariable);
report("set_throughAnotherVariable", plain_set_throughAnotherVariable, plain_set_throughAnotherVariable, meddle_set_throughAnotherVariable);
report("array_throughAGetter", plain_array_throughAGetter, plain_array_throughAGetter, meddle_array_throughAGetter);
report("map_throughAGetter", plain_map_throughAGetter, plain_map_throughAGetter, meddle_map_throughAGetter);
report("set_throughAGetter", plain_set_throughAGetter, plain_set_throughAGetter, meddle_set_throughAGetter);
report("array_throughAnArrow", plain_array_throughAnArrow, plain_array_throughAnArrow, meddle_array_throughAnArrow);
report("map_throughAnArrow", plain_map_throughAnArrow, plain_map_throughAnArrow, meddle_map_throughAnArrow);
report("set_throughAnArrow", plain_set_throughAnArrow, plain_set_throughAnArrow, meddle_set_throughAnArrow);
report("array_throughALiteral", plain_array_throughALiteral, plain_array_throughALiteral, meddle_array_throughALiteral);
report("map_throughALiteral", plain_map_throughALiteral, plain_map_throughALiteral, meddle_map_throughALiteral);
report("set_throughALiteral", plain_set_throughALiteral, plain_set_throughALiteral, meddle_set_throughALiteral);
report("array_throughAnObjectLiteral", plain_array_throughAnObjectLiteral, plain_array_throughAnObjectLiteral, meddle_array_throughAnObjectLiteral);
report("map_throughAnObjectLiteral", plain_map_throughAnObjectLiteral, plain_map_throughAnObjectLiteral, meddle_map_throughAnObjectLiteral);
report("set_throughAnObjectLiteral", plain_set_throughAnObjectLiteral, plain_set_throughAnObjectLiteral, meddle_set_throughAnObjectLiteral);
report("array_throughSpreadArguments", plain_array_throughSpreadArguments, plain_array_throughSpreadArguments, meddle_array_throughSpreadArguments);
report("map_throughSpreadArguments", plain_map_throughSpreadArguments, plain_map_throughSpreadArguments, meddle_map_throughSpreadArguments);
report("set_throughSpreadArguments", plain_set_throughSpreadArguments, plain_set_throughSpreadArguments, meddle_set_throughSpreadArguments);
report("array_throughThis", plain_array_throughThis, plain_array_throughThis, meddle_array_throughThis);
report("map_throughThis", plain_map_throughThis, plain_map_throughThis, meddle_map_throughThis);
report("set_throughThis", plain_set_throughThis, plain_set_throughThis, meddle_set_throughThis);
report("array_throughApply", plain_array_throughApply, plain_array_throughApply, meddle_array_throughApply);
report("map_throughApply", plain_map_throughApply, plain_map_throughApply, meddle_map_throughApply);
report("set_throughApply", plain_set_throughApply, plain_set_throughApply, meddle_set_throughApply);
report("array_throughBind", plain_array_throughBind, plain_array_throughBind, meddle_array_throughBind);
report("map_throughBind", plain_map_throughBind, plain_map_throughBind, meddle_map_throughBind);
report("set_throughBind", plain_set_throughBind, plain_set_throughBind, meddle_set_throughBind);
report("array_throughReflectApply", plain_array_throughReflectApply, plain_array_throughReflectApply, meddle_array_throughReflectApply);
report("map_throughReflectApply", plain_map_throughReflectApply, plain_map_throughReflectApply, meddle_map_throughReflectApply);
report("set_throughReflectApply", plain_set_throughReflectApply, plain_set_throughReflectApply, meddle_set_throughReflectApply);
report("array_thrownAndCaught", plain_array_thrownAndCaught, plain_array_thrownAndCaught, meddle_array_thrownAndCaught);
report("map_thrownAndCaught", plain_map_thrownAndCaught, plain_map_thrownAndCaught, meddle_map_thrownAndCaught);
report("set_thrownAndCaught", plain_set_thrownAndCaught, plain_set_thrownAndCaught, meddle_set_thrownAndCaught);
report("array_throughAJoin", plain_array_throughAJoin, plain_array_throughAJoin, meddle_array_throughAJoin);
report("map_throughAJoin", plain_map_throughAJoin, plain_map_throughAJoin, meddle_map_throughAJoin);
report("set_throughAJoin", plain_set_throughAJoin, plain_set_throughAJoin, meddle_set_throughAJoin);
report("array_throughAJoinNotTaken", plain_array_throughAJoinNotTaken, plain_array_throughAJoinNotTaken, meddle_array_throughAJoinNotTaken);
report("map_throughAJoinNotTaken", plain_map_throughAJoinNotTaken, plain_map_throughAJoinNotTaken, meddle_map_throughAJoinNotTaken);
report("set_throughAJoinNotTaken", plain_set_throughAJoinNotTaken, plain_set_throughAJoinNotTaken, meddle_set_throughAJoinNotTaken);
report("array_throughNullish", plain_array_throughNullish, plain_array_throughNullish, meddle_array_throughNullish);
report("map_throughNullish", plain_map_throughNullish, plain_map_throughNullish, meddle_map_throughNullish);
report("set_throughNullish", plain_set_throughNullish, plain_set_throughNullish, meddle_set_throughNullish);
report("array_throughDestructuring", plain_array_throughDestructuring, plain_array_throughDestructuring, meddle_array_throughDestructuring);
report("map_throughDestructuring", plain_map_throughDestructuring, plain_map_throughDestructuring, meddle_map_throughDestructuring);
report("set_throughDestructuring", plain_set_throughDestructuring, plain_set_throughDestructuring, meddle_set_throughDestructuring);
report("array_throughAProxy", plain_array_throughAProxy, plain_array_throughAProxy, meddle_array_throughAProxy);
report("map_throughAProxy", plain_map_throughAProxy, plain_map_throughAProxy, meddle_map_throughAProxy);
report("set_throughAProxy", plain_set_throughAProxy, plain_set_throughAProxy, meddle_set_throughAProxy);
report("array_throughAWeakRef", plain_array_throughAWeakRef, plain_array_throughAWeakRef, meddle_array_throughAWeakRef);
report("map_throughAWeakRef", plain_map_throughAWeakRef, plain_map_throughAWeakRef, meddle_map_throughAWeakRef);
report("set_throughAWeakRef", plain_set_throughAWeakRef, plain_set_throughAWeakRef, meddle_set_throughAWeakRef);
report("array_throughAClosureMadeEarly", plain_array_throughAClosureMadeEarly, plain_array_throughAClosureMadeEarly, meddle_array_throughAClosureMadeEarly);
report("map_throughAClosureMadeEarly", plain_map_throughAClosureMadeEarly, plain_map_throughAClosureMadeEarly, meddle_map_throughAClosureMadeEarly);
report("set_throughAClosureMadeEarly", plain_set_throughAClosureMadeEarly, plain_set_throughAClosureMadeEarly, meddle_set_throughAClosureMadeEarly);
report("array_thirdParameter", plain_array_thirdParameter, plain_array_thirdParameter, meddle_array_thirdParameter);
report("map_thirdParameter", plain_map_thirdParameter, plain_map_thirdParameter, meddle_map_thirdParameter);
report("set_thirdParameter", plain_set_thirdParameter, plain_set_thirdParameter, meddle_set_thirdParameter);
report("array_thirdParameterOfANamedFunction", plain_array_thirdParameterOfANamedFunction, plain_array_thirdParameterOfANamedFunction, meddle_array_thirdParameterOfANamedFunction);
report("map_thirdParameterOfANamedFunction", plain_map_thirdParameterOfANamedFunction, plain_map_thirdParameterOfANamedFunction, meddle_map_thirdParameterOfANamedFunction);
report("set_thirdParameterOfANamedFunction", plain_set_thirdParameterOfANamedFunction, plain_set_thirdParameterOfANamedFunction, meddle_set_thirdParameterOfANamedFunction);
report("array_argumentsObject", plain_array_argumentsObject, plain_array_argumentsObject, meddle_array_argumentsObject);
report("map_argumentsObject", plain_map_argumentsObject, plain_map_argumentsObject, meddle_map_argumentsObject);
report("set_argumentsObject", plain_set_argumentsObject, plain_set_argumentsObject, meddle_set_argumentsObject);
report("array_argumentsObjectByKey", plain_array_argumentsObjectByKey, plain_array_argumentsObjectByKey, meddle_array_argumentsObjectByKey);
report("map_argumentsObjectByKey", plain_map_argumentsObjectByKey, plain_map_argumentsObjectByKey, meddle_map_argumentsObjectByKey);
report("set_argumentsObjectByKey", plain_set_argumentsObjectByKey, plain_set_argumentsObjectByKey, meddle_set_argumentsObjectByKey);
report("array_restParameter", plain_array_restParameter, plain_array_restParameter, meddle_array_restParameter);
report("map_restParameter", plain_map_restParameter, plain_map_restParameter, meddle_map_restParameter);
report("set_restParameter", plain_set_restParameter, plain_set_restParameter, meddle_set_restParameter);
report("array_restBehindTwo", plain_array_restBehindTwo, plain_array_restBehindTwo, meddle_array_restBehindTwo);
report("map_restBehindTwo", plain_map_restBehindTwo, plain_map_restBehindTwo, meddle_map_restBehindTwo);
report("set_restBehindTwo", plain_set_restBehindTwo, plain_set_restBehindTwo, meddle_set_restBehindTwo);
report("array_restSpreadOn", plain_array_restSpreadOn, plain_array_restSpreadOn, meddle_array_restSpreadOn);
report("map_restSpreadOn", plain_map_restSpreadOn, plain_map_restSpreadOn, meddle_map_restSpreadOn);
report("set_restSpreadOn", plain_set_restSpreadOn, plain_set_restSpreadOn, meddle_set_restSpreadOn);
report("array_restLengthAndLast", plain_array_restLengthAndLast, plain_array_restLengthAndLast, meddle_array_restLengthAndLast);
report("map_restLengthAndLast", plain_map_restLengthAndLast, plain_map_restLengthAndLast, meddle_map_restLengthAndLast);
report("set_restLengthAndLast", plain_set_restLengthAndLast, plain_set_restLengthAndLast, meddle_set_restLengthAndLast);
report("array_defaultFromArguments", plain_array_defaultFromArguments, plain_array_defaultFromArguments, meddle_array_defaultFromArguments);
report("map_defaultFromArguments", plain_map_defaultFromArguments, plain_map_defaultFromArguments, meddle_map_defaultFromArguments);
report("set_defaultFromArguments", plain_set_defaultFromArguments, plain_set_defaultFromArguments, meddle_set_defaultFromArguments);
report("array_restBehindOne", plain_array_restBehindOne, plain_array_restBehindOne, meddle_array_restBehindOne);
report("map_restBehindOne", plain_map_restBehindOne, plain_map_restBehindOne, meddle_map_restBehindOne);
report("set_restBehindOne", plain_set_restBehindOne, plain_set_restBehindOne, meddle_set_restBehindOne);
report("array_callbackNotKnown", plain_array_callbackNotKnown, plain_array_callbackNotKnown, meddle_array_callbackNotKnown);
report("map_callbackNotKnown", plain_map_callbackNotKnown, plain_map_callbackNotKnown, meddle_map_callbackNotKnown);
report("set_callbackNotKnown", plain_set_callbackNotKnown, plain_set_callbackNotKnown, meddle_set_callbackNotKnown);
report("array_callbackOutOfAField", plain_array_callbackOutOfAField, plain_array_callbackOutOfAField, meddle_array_callbackOutOfAField);
report("map_callbackOutOfAField", plain_map_callbackOutOfAField, plain_map_callbackOutOfAField, meddle_map_callbackOutOfAField);
report("set_callbackOutOfAField", plain_set_callbackOutOfAField, plain_set_callbackOutOfAField, meddle_set_callbackOutOfAField);
report("array_callbackOneOfTwo", plain_array_callbackOneOfTwo, plain_array_callbackOneOfTwo, meddle_array_callbackOneOfTwo);
report("map_callbackOneOfTwo", plain_map_callbackOneOfTwo, plain_map_callbackOneOfTwo, meddle_map_callbackOneOfTwo);
report("set_callbackOneOfTwo", plain_set_callbackOneOfTwo, plain_set_callbackOneOfTwo, meddle_set_callbackOneOfTwo);
report("array_callbackBound", plain_array_callbackBound, plain_array_callbackBound, meddle_array_callbackBound);
report("map_callbackBound", plain_map_callbackBound, plain_map_callbackBound, meddle_map_callbackBound);
report("set_callbackBound", plain_set_callbackBound, plain_set_callbackBound, meddle_set_callbackBound);
report("array_thisArgument", plain_array_thisArgument, plain_array_thisArgument, meddle_array_thisArgument);
report("map_thisArgument", plain_map_thisArgument, plain_map_thisArgument, meddle_map_thisArgument);
report("set_thisArgument", plain_set_thisArgument, plain_set_thisArgument, meddle_set_thisArgument);
report("array_setPrototypeOf", plain_array_setPrototypeOf, plain_array_setPrototypeOf, meddle_array_setPrototypeOf);
report("map_setPrototypeOf", plain_map_setPrototypeOf, plain_map_setPrototypeOf, meddle_map_setPrototypeOf);
report("set_setPrototypeOf", plain_set_setPrototypeOf, plain_set_setPrototypeOf, meddle_set_setPrototypeOf);
report("array_reflectSetPrototypeOf", plain_array_reflectSetPrototypeOf, plain_array_reflectSetPrototypeOf, meddle_array_reflectSetPrototypeOf);
report("map_reflectSetPrototypeOf", plain_map_reflectSetPrototypeOf, plain_map_reflectSetPrototypeOf, meddle_map_reflectSetPrototypeOf);
report("set_reflectSetPrototypeOf", plain_set_reflectSetPrototypeOf, plain_set_reflectSetPrototypeOf, meddle_set_reflectSetPrototypeOf);
report("array_protoAssigned", plain_array_protoAssigned, plain_array_protoAssigned, meddle_array_protoAssigned);
report("map_protoAssigned", plain_map_protoAssigned, plain_map_protoAssigned, meddle_map_protoAssigned);
report("set_protoAssigned", plain_set_protoAssigned, plain_set_protoAssigned, meddle_set_protoAssigned);
report("array_defineProperty", plain_array_defineProperty, plain_array_defineProperty, meddle_array_defineProperty);
report("map_defineProperty", plain_map_defineProperty, plain_map_defineProperty, meddle_map_defineProperty);
report("set_defineProperty", plain_set_defineProperty, plain_set_defineProperty, meddle_set_defineProperty);
report("array_defineProperties", plain_array_defineProperties, plain_array_defineProperties, meddle_array_defineProperties);
report("map_defineProperties", plain_map_defineProperties, plain_map_defineProperties, meddle_map_defineProperties);
report("set_defineProperties", plain_set_defineProperties, plain_set_defineProperties, meddle_set_defineProperties);
report("array_reflectDefineProperty", plain_array_reflectDefineProperty, plain_array_reflectDefineProperty, meddle_array_reflectDefineProperty);
report("map_reflectDefineProperty", plain_map_reflectDefineProperty, plain_map_reflectDefineProperty, meddle_map_reflectDefineProperty);
report("set_reflectDefineProperty", plain_set_reflectDefineProperty, plain_set_reflectDefineProperty, meddle_set_reflectDefineProperty);
report("array_reflectSet", plain_array_reflectSet, plain_array_reflectSet, meddle_array_reflectSet);
report("map_reflectSet", plain_map_reflectSet, plain_map_reflectSet, meddle_map_reflectSet);
report("set_reflectSet", plain_set_reflectSet, plain_set_reflectSet, meddle_set_reflectSet);
report("array_objectAssign", plain_array_objectAssign, plain_array_objectAssign, meddle_array_objectAssign);
report("map_objectAssign", plain_map_objectAssign, plain_map_objectAssign, meddle_map_objectAssign);
report("set_objectAssign", plain_set_objectAssign, plain_set_objectAssign, meddle_set_objectAssign);
report("array_frozen", plain_array_frozen, plain_array_frozen, meddle_array_frozen);
report("map_frozen", plain_map_frozen, plain_map_frozen, meddle_map_frozen);
report("set_frozen", plain_set_frozen, plain_set_frozen, meddle_set_frozen);
report("array_sealed", plain_array_sealed, plain_array_sealed, meddle_array_sealed);
report("map_sealed", plain_map_sealed, plain_map_sealed, meddle_map_sealed);
report("set_sealed", plain_set_sealed, plain_set_sealed, meddle_set_sealed);
report("array_notExtensible", plain_array_notExtensible, plain_array_notExtensible, meddle_array_notExtensible);
report("map_notExtensible", plain_map_notExtensible, plain_map_notExtensible, meddle_map_notExtensible);
report("set_notExtensible", plain_set_notExtensible, plain_set_notExtensible, meddle_set_notExtensible);
report("array_frozenAtBirth", plain_array_frozenAtBirth, plain_array_frozenAtBirth, meddle_array_frozenAtBirth);
report("map_frozenAtBirth", plain_map_frozenAtBirth, plain_map_frozenAtBirth, meddle_map_frozenAtBirth);
report("set_frozenAtBirth", plain_set_frozenAtBirth, plain_set_frozenAtBirth, meddle_set_frozenAtBirth);
report("array_assignedAtBirth", plain_array_assignedAtBirth, plain_array_assignedAtBirth, meddle_array_assignedAtBirth);
report("map_assignedAtBirth", plain_map_assignedAtBirth, plain_map_assignedAtBirth, meddle_map_assignedAtBirth);
report("set_assignedAtBirth", plain_set_assignedAtBirth, plain_set_assignedAtBirth, meddle_set_assignedAtBirth);
report("array_anHeirAtBirth", plain_array_anHeirAtBirth, plain_array_anHeirAtBirth, meddle_array_anHeirAtBirth);
report("map_anHeirAtBirth", plain_map_anHeirAtBirth, plain_map_anHeirAtBirth, meddle_map_anHeirAtBirth);
report("set_anHeirAtBirth", plain_set_anHeirAtBirth, plain_set_anHeirAtBirth, meddle_set_anHeirAtBirth);
report("array_anHeirLater", plain_array_anHeirLater, plain_array_anHeirLater, meddle_array_anHeirLater);
report("map_anHeirLater", plain_map_anHeirLater, plain_map_anHeirLater, meddle_map_anHeirLater);
report("set_anHeirLater", plain_set_anHeirLater, plain_set_anHeirLater, meddle_set_anHeirLater);
report("array_anotherLater", plain_array_anotherLater, plain_array_anotherLater, meddle_array_anotherLater);
report("map_anotherLater", plain_map_anotherLater, plain_map_anotherLater, meddle_map_anotherLater);
report("set_anotherLater", plain_set_anotherLater, plain_set_anotherLater, meddle_set_anotherLater);
report("array_anotherLaterThatIsKept", plain_array_anotherLaterThatIsKept, plain_array_anotherLaterThatIsKept, meddle_array_anotherLaterThatIsKept);
report("map_anotherLaterThatIsKept", plain_map_anotherLaterThatIsKept, plain_map_anotherLaterThatIsKept, meddle_map_anotherLaterThatIsKept);
report("set_anotherLaterThatIsKept", plain_set_anotherLaterThatIsKept, plain_set_anotherLaterThatIsKept, meddle_set_anotherLaterThatIsKept);
report("array_givenLater", plain_array_givenLater, plain_array_givenLater, meddle_array_givenLater);
report("map_givenLater", plain_map_givenLater, plain_map_givenLater, meddle_map_givenLater);
report("set_givenLater", plain_set_givenLater, plain_set_givenLater, meddle_set_givenLater);
report("array_undefinedLater", plain_array_undefinedLater, plain_array_undefinedLater, meddle_array_undefinedLater);
report("map_undefinedLater", plain_map_undefinedLater, plain_map_undefinedLater, meddle_map_undefinedLater);
report("set_undefinedLater", plain_set_undefinedLater, plain_set_undefinedLater, meddle_set_undefinedLater);
report("array_nullLater", plain_array_nullLater, plain_array_nullLater, meddle_array_nullLater);
report("map_nullLater", plain_map_nullLater, plain_map_nullLater, meddle_map_nullLater);
report("set_nullLater", plain_set_nullLater, plain_set_nullLater, meddle_set_nullLater);
report("array_undefinedOnOneRoad", plain_array_undefinedOnOneRoad, plain_array_undefinedOnOneRoad, meddle_array_undefinedOnOneRoad);
report("map_undefinedOnOneRoad", plain_map_undefinedOnOneRoad, plain_map_undefinedOnOneRoad, meddle_map_undefinedOnOneRoad);
report("set_undefinedOnOneRoad", plain_set_undefinedOnOneRoad, plain_set_undefinedOnOneRoad, meddle_set_undefinedOnOneRoad);
report("array_undefinedThenAnother", plain_array_undefinedThenAnother, plain_array_undefinedThenAnother, meddle_array_undefinedThenAnother);
report("map_undefinedThenAnother", plain_map_undefinedThenAnother, plain_map_undefinedThenAnother, meddle_map_undefinedThenAnother);
report("set_undefinedThenAnother", plain_set_undefinedThenAnother, plain_set_undefinedThenAnother, meddle_set_undefinedThenAnother);
report("array_usedBeforeItsDeclaration", plain_array_usedBeforeItsDeclaration, plain_array_usedBeforeItsDeclaration, meddle_array_usedBeforeItsDeclaration);
report("map_usedBeforeItsDeclaration", plain_map_usedBeforeItsDeclaration, plain_map_usedBeforeItsDeclaration, meddle_map_usedBeforeItsDeclaration);
report("set_usedBeforeItsDeclaration", plain_set_usedBeforeItsDeclaration, plain_set_usedBeforeItsDeclaration, meddle_set_usedBeforeItsDeclaration);
report("array_varUsedBeforeItsDeclaration", plain_array_varUsedBeforeItsDeclaration, plain_array_varUsedBeforeItsDeclaration, meddle_array_varUsedBeforeItsDeclaration);
report("map_varUsedBeforeItsDeclaration", plain_map_varUsedBeforeItsDeclaration, plain_map_varUsedBeforeItsDeclaration, meddle_map_varUsedBeforeItsDeclaration);
report("set_varUsedBeforeItsDeclaration", plain_set_varUsedBeforeItsDeclaration, plain_set_varUsedBeforeItsDeclaration, meddle_set_varUsedBeforeItsDeclaration);
report("array_aNamedProperty", plain_array_aNamedProperty, plain_array_aNamedProperty, meddle_array_aNamedProperty);
report("map_aNamedProperty", plain_map_aNamedProperty, plain_map_aNamedProperty, meddle_map_aNamedProperty);
report("set_aNamedProperty", plain_set_aNamedProperty, plain_set_aNamedProperty, meddle_set_aNamedProperty);
report("map_symbolIterator", plain_map_symbolIterator, plain_map_symbolIterator, meddle_map_symbolIterator);
report("set_symbolIterator", plain_set_symbolIterator, plain_set_symbolIterator, meddle_set_symbolIterator);
report("array_jsonReplacer", plain_array_jsonReplacer, plain_array_jsonReplacer, meddle_array_jsonReplacer);
report("array_constructorSpecies", plain_array_constructorSpecies, plain_array_constructorSpecies, meddle_array_constructorSpecies);
report("array_sortYieldsIt", plain_array_sortYieldsIt, plain_array_sortYieldsIt, meddle_array_sortYieldsIt);
report("array_reverseYieldsIt", plain_array_reverseYieldsIt, plain_array_reverseYieldsIt, meddle_array_reverseYieldsIt);
report("array_fillYieldsIt", plain_array_fillYieldsIt, plain_array_fillYieldsIt, meddle_array_fillYieldsIt);
report("array_fourthParameterOfReduce", plain_array_fourthParameterOfReduce, plain_array_fourthParameterOfReduce, meddle_array_fourthParameterOfReduce);
report("map_setYieldsIt", plain_map_setYieldsIt, plain_map_setYieldsIt, meddle_map_setYieldsIt);
report("set_addYieldsIt", plain_set_addYieldsIt, plain_set_addYieldsIt, meddle_set_addYieldsIt);
report("array_lengthStored", plain_array_lengthStored, plain_array_lengthStored, meddle_array_lengthStored);
report("array_elementFarAway", plain_array_elementFarAway, plain_array_elementFarAway, meddle_array_elementFarAway);
report("array_elementVeryFarAway", plain_array_elementVeryFarAway, plain_array_elementVeryFarAway, meddle_array_elementVeryFarAway);
report("array_elementDeleted", plain_array_elementDeleted, plain_array_elementDeleted, meddle_array_elementDeleted);
report("array_elementByAStringKey", plain_array_elementByAStringKey, plain_array_elementByAStringKey, meddle_array_elementByAStringKey);
report("array_pushed", plain_array_pushed, plain_array_pushed, meddle_array_pushed);
report("array_popped", plain_array_popped, plain_array_popped, meddle_array_popped);
report("array_spliced", plain_array_spliced, plain_array_spliced, meddle_array_spliced);
report("map_cleared", plain_map_cleared, plain_map_cleared, meddle_map_cleared);
report("set_cleared", plain_set_cleared, plain_set_cleared, meddle_set_cleared);
report("array_concatSpreadable", plain_array_concatSpreadable, plain_array_concatSpreadable, meddle_array_concatSpreadable);
report("array_iteratorKept", plain_array_iteratorKept, plain_array_iteratorKept, meddle_array_iteratorKept);
report("map_iteratorKept", plain_map_iteratorKept, plain_map_iteratorKept, meddle_map_iteratorKept);
report("set_iteratorKept", plain_set_iteratorKept, plain_set_iteratorKept, meddle_set_iteratorKept);
report("array_handedToABuiltin", plain_array_handedToABuiltin, plain_array_handedToABuiltin, meddle_array_handedToABuiltin);
report("map_handedToABuiltin", plain_map_handedToABuiltin, plain_map_handedToABuiltin, meddle_map_handedToABuiltin);
report("set_handedToABuiltin", plain_set_handedToABuiltin, plain_set_handedToABuiltin, meddle_set_handedToABuiltin);
report("array_handedToAConstructor", plain_array_handedToAConstructor, plain_array_handedToAConstructor, meddle_array_handedToAConstructor);
report("map_handedToAConstructor", plain_map_handedToAConstructor, plain_map_handedToAConstructor, meddle_map_handedToAConstructor);
report("set_handedToAConstructor", plain_set_handedToAConstructor, plain_set_handedToAConstructor, meddle_set_handedToAConstructor);
report("array_structuredCloned", plain_array_structuredCloned, plain_array_structuredCloned, meddle_array_structuredCloned);
report("map_structuredCloned", plain_map_structuredCloned, plain_map_structuredCloned, meddle_map_structuredCloned);
report("set_structuredCloned", plain_set_structuredCloned, plain_set_structuredCloned, meddle_set_structuredCloned);
report("array_awaited", plain_array_awaited, plain_array_awaited, meddle_array_awaited);
report("map_awaited", plain_map_awaited, plain_map_awaited, meddle_map_awaited);
report("set_awaited", plain_set_awaited, plain_set_awaited, meddle_set_awaited);
report("array_resolved", plain_array_resolved, plain_array_resolved, meddle_array_resolved);
report("map_resolved", plain_map_resolved, plain_map_resolved, meddle_map_resolved);
report("set_resolved", plain_set_resolved, plain_set_resolved, meddle_set_resolved);
report("array_liveAcrossAnAwait", plain_array_liveAcrossAnAwait, plain_array_liveAcrossAnAwait, meddle_array_liveAcrossAnAwait);
report("map_liveAcrossAnAwait", plain_map_liveAcrossAnAwait, plain_map_liveAcrossAnAwait, meddle_map_liveAcrossAnAwait);
report("set_liveAcrossAnAwait", plain_set_liveAcrossAnAwait, plain_set_liveAcrossAnAwait, meddle_set_liveAcrossAnAwait);
report("array_liveAcrossAnAwaitAndAlteredMeanwhile", plain_array_liveAcrossAnAwaitAndAlteredMeanwhile, plain_array_liveAcrossAnAwaitAndAlteredMeanwhile, meddle_array_liveAcrossAnAwaitAndAlteredMeanwhile);
report("map_liveAcrossAnAwaitAndAlteredMeanwhile", plain_map_liveAcrossAnAwaitAndAlteredMeanwhile, plain_map_liveAcrossAnAwaitAndAlteredMeanwhile, meddle_map_liveAcrossAnAwaitAndAlteredMeanwhile);
report("set_liveAcrossAnAwaitAndAlteredMeanwhile", plain_set_liveAcrossAnAwaitAndAlteredMeanwhile, plain_set_liveAcrossAnAwaitAndAlteredMeanwhile, meddle_set_liveAcrossAnAwaitAndAlteredMeanwhile);
report("array_yielded", plain_array_yielded, plain_array_yielded, meddle_array_yielded);
report("map_yielded", plain_map_yielded, plain_map_yielded, meddle_map_yielded);
report("set_yielded", plain_set_yielded, plain_set_yielded, meddle_set_yielded);
report("array_inATemplate", plain_array_inATemplate, plain_array_inATemplate, meddle_array_inATemplate);
report("array_compared", plain_array_compared, plain_array_compared, meddle_array_compared);
report("map_compared", plain_map_compared, plain_map_compared, meddle_map_compared);
report("set_compared", plain_set_compared, plain_set_compared, meddle_set_compared);
report("array_instanceOfAClassWithHasInstance", plain_array_instanceOfAClassWithHasInstance, plain_array_instanceOfAClassWithHasInstance, meddle_array_instanceOfAClassWithHasInstance);
report("map_instanceOfAClassWithHasInstance", plain_map_instanceOfAClassWithHasInstance, plain_map_instanceOfAClassWithHasInstance, meddle_map_instanceOfAClassWithHasInstance);
report("set_instanceOfAClassWithHasInstance", plain_set_instanceOfAClassWithHasInstance, plain_set_instanceOfAClassWithHasInstance, meddle_set_instanceOfAClassWithHasInstance);
report("array_keyOfAWeakMap", plain_array_keyOfAWeakMap, plain_array_keyOfAWeakMap, meddle_array_keyOfAWeakMap);
report("map_keyOfAWeakMap", plain_map_keyOfAWeakMap, plain_map_keyOfAWeakMap, meddle_map_keyOfAWeakMap);
report("set_keyOfAWeakMap", plain_set_keyOfAWeakMap, plain_set_keyOfAWeakMap, meddle_set_keyOfAWeakMap);
report("array_valueOfAMap", plain_array_valueOfAMap, plain_array_valueOfAMap, meddle_array_valueOfAMap);
report("map_valueOfAMap", plain_map_valueOfAMap, plain_map_valueOfAMap, meddle_map_valueOfAMap);
report("set_valueOfAMap", plain_set_valueOfAMap, plain_set_valueOfAMap, meddle_set_valueOfAMap);
report("array_elementOfAnArray", plain_array_elementOfAnArray, plain_array_elementOfAnArray, meddle_array_elementOfAnArray);
report("map_elementOfAnArray", plain_map_elementOfAnArray, plain_map_elementOfAnArray, meddle_map_elementOfAnArray);
report("set_elementOfAnArray", plain_set_elementOfAnArray, plain_set_elementOfAnArray, meddle_set_elementOfAnArray);
report("array_globalThisProperty", plain_array_globalThisProperty, plain_array_globalThisProperty, meddle_array_globalThisProperty);
report("map_globalThisProperty", plain_map_globalThisProperty, plain_map_globalThisProperty, meddle_map_globalThisProperty);
report("set_globalThisProperty", plain_set_globalThisProperty, plain_set_globalThisProperty, meddle_set_globalThisProperty);
await Promise.resolve();
await Promise.resolve();
try { lines.push("array_awaited later: " + plain_array_awaited()); } catch (e) { lines.push("array_awaited later: " + thrown(e)); }
try { lines.push("map_awaited later: " + plain_map_awaited()); } catch (e) { lines.push("map_awaited later: " + thrown(e)); }
try { lines.push("set_awaited later: " + plain_set_awaited()); } catch (e) { lines.push("set_awaited later: " + thrown(e)); }
try { lines.push("array_resolved later: " + plain_array_resolved()); } catch (e) { lines.push("array_resolved later: " + thrown(e)); }
try { lines.push("map_resolved later: " + plain_map_resolved()); } catch (e) { lines.push("map_resolved later: " + thrown(e)); }
try { lines.push("set_resolved later: " + plain_set_resolved()); } catch (e) { lines.push("set_resolved later: " + thrown(e)); }
console.log(lines.join("\n"));
