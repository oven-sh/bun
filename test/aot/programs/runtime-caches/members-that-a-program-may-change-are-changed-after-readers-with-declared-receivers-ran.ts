// Readers with declared receivers, run between changes to the members of built-in prototypes that a program may change.
function show(f: () => unknown): string {
    try { const v = f(); return typeof v === "function" ? "function " + v.name : String(v); } catch (e: any) { return "threw " + (e && e.constructor && e.constructor.name); }
}
const d = new Date(86400000 * 365.25 * 30);
const e = new RangeError("out");
const bare = new Error();
const controller = new AbortController();
const signal: AbortSignal = controller.signal;
const target = new EventTarget();
const m = new Map<string, number>([["a", 1]]);
const s = new Set<number>([1, 2]);
const w = new WeakMap<object, number>();
let heard = 0;

function trimOf(x: string) { return x.trim(); }
function trimStartOf(x: string) { return x.trimStart(); }
function trimEndOf(x: string) { return x.trimEnd(); }
function atOf(x: string, i: number) { return x.at(i); }
function boldOf(x: string) { return x.bold(); }
function dateText(x: Date) { return x.toString(); }
function dateTemplate(x: Date) { return `${x}`; }
function dateConcat(x: Date) { return "" + x; }
function dateLocale(x: Date) { return x.toLocaleDateString("en-US", { timeZone: "UTC" }); }
function errorText(x: Error) { return String(x); }
function errorTemplate(x: Error) { return `${x}`; }
function errorName(x: Error) { return x.name; }
function errorMessage(x: Error) { return x.message; }
function errorConstructor(x: Error) { return x.constructor; }
function aborted(x: AbortSignal) { return x.aborted; }
function reason(x: AbortSignal) { return x.reason; }
function throwIf(x: AbortSignal) { return x.throwIfAborted(); }
function listen(x: EventTarget) { x.addEventListener("ping", () => { heard++; }); x.dispatchEvent(new Event("ping")); return heard; }
function insert(x: Map<string, number>) { return (x as any).getOrInsert("b", 2); }
function union(x: Set<number>) { return [...(x as any).union(new Set([3]))].join(); }
function weakInsert(x: WeakMap<object, number>) { return (x as any).getOrInsert(d, 2); }

function stage(label: string) {
    for (let turn = 0; turn < 3; turn++) {
        const line = [
            show(() => trimOf("  a ")), show(() => trimStartOf("  a ")), show(() => trimEndOf("  a ")), show(() => atOf("abc", -1)), show(() => boldOf("b")),
            show(() => dateText(d)), show(() => dateTemplate(d)), show(() => dateConcat(d)), show(() => dateLocale(d)),
            show(() => errorText(e)), show(() => errorTemplate(e)), show(() => errorName(e)), show(() => errorMessage(e)), show(() => errorConstructor(e)),
            show(() => errorText(bare)), show(() => errorName(bare)), show(() => errorMessage(bare)),
            show(() => aborted(signal)), show(() => reason(signal)), show(() => throwIf(signal)), show(() => listen(target)),
            show(() => insert(m)), show(() => union(s)), show(() => weakInsert(w)),
        ].join(" | ");
        console.log(label, turn, line);
    }
}

const places: [object, PropertyKey][] = [
    [String.prototype, "trim"], [String.prototype, "trimStart"], [String.prototype, "trimEnd"], [String.prototype, "at"], [String.prototype, "bold"],
    [Date.prototype, "toString"], [Date.prototype, "toLocaleDateString"],
    [Error.prototype, "toString"], [Error.prototype, "name"], [Error.prototype, "message"], [Error.prototype, "constructor"],
    [RangeError.prototype, "name"], [RangeError.prototype, "message"], [RangeError.prototype, "constructor"],
    [AbortSignal.prototype, "aborted"], [AbortSignal.prototype, "reason"], [AbortSignal.prototype, "throwIfAborted"],
    [EventTarget.prototype, "addEventListener"], [EventTarget.prototype, "dispatchEvent"],
    [Map.prototype, "getOrInsert"], [Set.prototype, "union"], [WeakMap.prototype, "getOrInsert"],
];
const kept = places.map(([o, k]) => Reflect.getOwnPropertyDescriptor(o, k));
function restore() { places.forEach(([o, k], i) => { if (kept[i]) Reflect.defineProperty(o, k, kept[i]!); else Reflect.deleteProperty(o, k); }); }
function each(label: string, change: (o: any, k: PropertyKey, i: number) => unknown) {
    const did = places.map(([o, k], i) => show(() => change(o, k, i)));
    console.log(label, "changes:", did.join());
    stage(label);
    restore();
    stage(label + " undone");
}

const order = process.argv[2] ?? "warm";
if (order === "warm") stage("start");
each("assigned", (o, k, i) => { o[k] = function () { return "assigned" + i; }; });
each("getter", (o, k, i) => Reflect.defineProperty(o, k, { get() { return () => "got" + i; }, configurable: true }));
each("getter of a string", (o, k, i) => Reflect.defineProperty(o, k, { get() { return "text" + i; }, configurable: true }));
each("deleted", (o, k) => Reflect.deleteProperty(o, k));
each("a number", (o, k, i) => Reflect.defineProperty(o, k, { value: i, configurable: true, writable: false }));
each("throwing getter", (o, k) => Reflect.defineProperty(o, k, { get() { throw new TypeError("no"); }, configurable: true }));
each("deleted, many names come and go", (o, k) => { Reflect.deleteProperty(o, k); for (let i = 0; i < 90; i++) o["n" + i] = i; for (let i = 0; i < 90; i++) delete o["n" + i]; });
controller.abort(new Error("stop"));
stage("aborted");
each("getter after the abort", (o, k, i) => Reflect.defineProperty(o, k, { get() { return () => "late" + i; }, configurable: true }));
