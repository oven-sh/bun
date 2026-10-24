// Stores under names a class does not declare: adding, replacing, past the inline capacity, of young cells into old objects, after preventExtensions and freeze, over accessors, over a method's name.
class Point {
    x: number;
    y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    norm(): number { return this.x * this.x + this.y * this.y; }
}
type Put = (target: Point, value: unknown) => void;
type Route = { title: string; put: Put; putNine: (target: Point, base: number) => void; read: (target: Point) => string };

function putTyped(point: Point, value: unknown): void { (point as any).tag = value; }
function putUntyped(object: any, value: unknown): void { object.tag = value; }
function putNineTyped(point: Point, base: number): void {
    const object = point as any;
    object.a = base + 1; object.b = base + 2; object.c = base + 3;
    object.d = base + 4; object.e = base + 5; object.f = base + 6;
    object.g = base + 7; object.h = base + 8; object.i = base + 9;
}
function putNineUntyped(object: any, base: number): void {
    object.a = base + 1; object.b = base + 2; object.c = base + 3;
    object.d = base + 4; object.e = base + 5; object.f = base + 6;
    object.g = base + 7; object.h = base + 8; object.i = base + 9;
}
// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict store.
class StrictCode {
    static mode = function (this: unknown): string { return this === undefined ? "strict" : "sloppy"; };
    static putTyped = function (point: Point, value: unknown): void { (point as any).tag = value; };
    static putUntyped = function (object: any, value: unknown): void { object.tag = value; };
    static putNineTyped = function (point: Point, base: number): void {
        const object = point as any;
        object.a = base + 1; object.b = base + 2; object.c = base + 3;
        object.d = base + 4; object.e = base + 5; object.f = base + 6;
        object.g = base + 7; object.h = base + 8; object.i = base + 9;
    };
    static putNineUntyped = function (object: any, base: number): void {
        object.a = base + 1; object.b = base + 2; object.c = base + 3;
        object.d = base + 4; object.e = base + 5; object.f = base + 6;
        object.g = base + 7; object.h = base + 8; object.i = base + 9;
    };
}
const { mode: classCodeMode, putTyped: putTypedStrictly, putUntyped: putUntypedStrictly, putNineTyped: putNineTypedStrictly, putNineUntyped: putNineUntypedStrictly } = StrictCode;
function readTyped(point: Point): string {
    const object = point as any;
    return [object.tag, object.a, object.b, object.c, object.d, object.e, object.f, object.g, object.h, object.i].join();
}
function readUntyped(object: any): string {
    return [object.tag, object.a, object.b, object.c, object.d, object.e, object.f, object.g, object.h, object.i].join();
}
function shadowTyped(point: Point, value: unknown): void { (point as any).norm = value; }
function shadowUntyped(object: any, value: unknown): void { object.norm = value; }
const routes: Route[] = [
    { title: "typed", put: putTyped, putNine: putNineTyped, read: readTyped },
    { title: "typed strict", put: putTypedStrictly, putNine: putNineTypedStrictly, read: readTyped },
    { title: "untyped", put: putUntyped, putNine: putNineUntyped, read: readUntyped },
    { title: "untyped strict", put: putUntypedStrictly, putNine: putNineUntypedStrictly, read: readUntyped },
];

function describeResult(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function digest(texts: string[]): string {
    let hash = 0;
    for (const text of texts) for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return texts[0] + " .. " + texts[texts.length - 1] + " #" + hash;
}
function state(route: Route, point: Point): string { return "[" + route.read(point) + "] " + Object.keys(point).join() + " " + describeResult(() => point.norm()); }
const allocatedArrays: unknown[] = [];
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
const collectYoung: () => void = (globalThis as any).edenGC ?? (() => { for (let i = 0; i < 1000000; i++) allocatedArrays[i & 1023] = [i]; });

function storeInMany(route: Route): void {
    const report = (label: string, text: string) => console.log(route.title + ", " + label + ": " + text);
    const points: Point[] = [];
    for (let i = 0; i < 100; i++) points.push(new Point(i, -i));
    const readAll = () => digest(points.map(point => route.read(point)));
    for (const point of points) route.put(point, point.x);
    report("added", readAll());
    for (const point of points) route.put(point, point.x * 2);
    report("replaced", readAll());
    for (const point of points) route.putNine(point, point.x * 10);
    report("nine more", readAll());
    for (const point of points) route.putNine(point, point.x * 100);
    report("nine replaced", readAll());
    collect();
    for (const point of points) route.put(point, ["young", point.x]);
    collectYoung();
    report("young cells", readAll());
    report("keys", [...new Set(points.map(point => Object.keys(point).join()))].join(" | "));
    report("fields", String(points.reduce((sum, point) => sum + point.norm(), 0)));
}

function storeAfterIntegrityChange(route: Route): void {
    const report = (label: string, text: string) => console.log(route.title + ", " + label + ": " + text);
    const closed = new Point(1, 2);
    Object.preventExtensions(closed);
    report("not extensible", describeResult(() => route.put(closed, 5)) + " " + describeResult(() => route.putNine(closed, 10)) + " " + state(route, closed));
    const closedLater = new Point(1, 2);
    route.put(closedLater, 1);
    Object.preventExtensions(closedLater);
    report("not extensible after one", describeResult(() => route.put(closedLater, 2)) + " " + describeResult(() => route.putNine(closedLater, 10)) + " " + state(route, closedLater));
    const frozen = new Point(1, 2);
    route.put(frozen, 1);
    route.putNine(frozen, 10);
    Object.freeze(frozen);
    report("frozen", describeResult(() => route.put(frozen, 2)) + " " + describeResult(() => route.putNine(frozen, 20)) + " " + state(route, frozen));
}

function storeOverAccessors(route: Route): void {
    const report = (label: string, text: string) => console.log(route.title + ", " + label + ": " + text);
    const seen: unknown[] = [];
    const accessor = { get: () => seen.length, set: (value: unknown) => { seen.push(value); }, enumerable: true, configurable: true };
    const watched = new Point(3, 4);
    Object.defineProperty(watched, "tag", accessor);
    route.put(watched, 7);
    route.put(watched, 8);
    report("setter", seen.join() + " " + state(route, watched));
    const redefined = new Point(3, 4);
    route.put(redefined, 1);
    Object.defineProperty(redefined, "tag", accessor);
    route.put(redefined, 9);
    route.putNine(redefined, 10);
    report("setter over a value", seen.join() + " " + state(route, redefined));
    const readOnly = new Point(3, 4);
    Object.defineProperty(readOnly, "tag", { get: () => "got", configurable: true });
    report("getter alone", describeResult(() => route.put(readOnly, 1)) + " " + state(route, readOnly));
}

function shadowMethod(title: string, shadow: Put): void {
    const shadowed = new Point(5, 6);
    shadow(shadowed, 9);
    console.log(title + ", method name: " + Object.keys(shadowed).join() + " " + Object.values(shadowed).join() + " " + describeResult(() => shadowed.norm()));
    shadow(shadowed, () => -1);
    putUntyped(shadowed, "late");
    console.log(title + ", method replaced: " + shadowed.norm() + " " + Object.keys(shadowed).join() + " " + (shadowed as any).tag + " " + new Point(5, 6).norm());
    delete (shadowed as any).norm;
    console.log(title + ", method restored: " + shadowed.norm() + " " + Object.keys(shadowed).join());
}

console.log("functions without a directive are " + (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
console.log("functions in a class body are " + classCodeMode());
const parsed: any = JSON.parse('{"x":0,"y":0}');
putUntyped(parsed, 1);
putUntypedStrictly(parsed, 2);
putNineUntyped(parsed, 10);
putNineUntypedStrictly(parsed, 20);
shadowUntyped(parsed, 3);
console.log("parsed object: " + readUntyped(parsed) + " " + Object.keys(parsed).join());
for (const route of routes) storeInMany(route);
for (const route of routes) storeAfterIntegrityChange(route);
for (const route of routes) storeOverAccessors(route);
shadowMethod("typed", shadowTyped);
shadowMethod("untyped", shadowUntyped);
// This store makes the file a CommonJS module, so a function without a "use strict" directive is sloppy.
module.exports = {};
