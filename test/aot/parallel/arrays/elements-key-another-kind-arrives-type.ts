// An access by key that calls a stub picks the stub by what its receiver is expected to be: an Int32Array, a Uint8Array, an array of numbers. Whatever arrives gets the answer of the language.
const unseen = new Function("x", "return x") as <T>(x: T) => T;
interface Holder { ints: Int32Array; bytes: Uint8Array; numbers: number[] }
const show = (v: unknown): string => (typeof v === "number" && Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

function readInt(h: Holder, i: number): unknown { return h.ints[i]; }
function readByte(h: Holder, i: number): unknown { return h.bytes[i]; }
function readNumber(h: Holder, i: number): unknown { return h.numbers[i]; }
function storeInt(h: Holder, i: number, v: number): void { h.ints[i] = v; }
function storeByte(h: Holder, i: number, v: number): void { h.bytes[i] = v; }
function storeNumber(h: Holder, i: number, v: number): void { h.numbers[i] = v; }
function readIntByValue(h: Holder, i: any): unknown { return h.ints[i]; }
function readNumberByValue(h: Holder, i: any): unknown { return h.numbers[i]; }
function storeIntByValue(h: Holder, i: any, v: any): void { h.ints[i] = v; }
function storeNumberByValue(h: Holder, i: any, v: any): void { h.numbers[i] = v; }

class Counted extends Int32Array { get total(): number { return this.length; } }
const detached = new Int32Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
const resizable = new Int32Array(new ArrayBuffer(16, { maxByteLength: 64 }));
const tracked = new Int32Array(resizable.buffer);
const frozen = Object.freeze([1.5, 2.5, 3.5]);
const sealed = Object.seal([1.5, 2.5, 3.5]);
const withHole = [1.5, , 3.5];
const readOnlyElement = [1.5, 2.5, 3.5]; Object.defineProperty(readOnlyElement, 1, { value: 9.5, writable: false });
const withGetter = [1.5, 2.5, 3.5]; Object.defineProperty(withGetter, 1, { get() { return "got"; }, set(v) { log.push("set " + v); } });
const log: string[] = [];
const proxy = new Proxy([1.5, 2.5], { get(t, k) { log.push("get " + String(k)); return Reflect.get(t, k); }, set(t, k, v) { log.push("put " + String(k)); return Reflect.set(t, k, v); } });

const kinds: [string, () => unknown][] = [
    ["Int32Array", () => new Int32Array([1, -2, 3, 2147483647])],
    ["Uint8Array", () => new Uint8Array([1, 2, 255, 4])],
    ["Int8Array", () => new Int8Array([1, -2, 127, 4])],
    ["Uint32Array", () => new Uint32Array([1, 4294967295, 3, 4])],
    ["Float64Array", () => new Float64Array([1.5, NaN, -0, 4])],
    ["Uint8ClampedArray", () => new Uint8ClampedArray([1, 2, 255, 4])],
    ["BigInt64Array", () => new BigInt64Array([1n, 2n, 3n, 4n])],
    ["subclass", () => new Counted([7, 8, 9, 10])],
    ["detached", () => detached],
    ["resizable", () => resizable],
    ["doubles", () => [1.5, 2.5, -0, 4.25]],
    ["constant doubles", () => [0.5, 1.5, 2.5, 3.5]],
    ["whole doubles", () => { const a = [1.5, 2, 3, 4]; a[0] = 1; return a; }],
    ["int32s", () => [1, 2, 3, 4]],
    ["values", () => ["a", {}, null, 4]],
    ["empty", () => []],
    ["hole", () => withHole.slice()],
    ["NaN inside", () => [1.5, NaN, 3.5]],
    ["frozen", () => frozen],
    ["sealed", () => sealed],
    ["read-only element", () => readOnlyElement],
    ["accessor element", () => withGetter],
    ["proxy", () => proxy],
    ["string", () => "abcd"],
    ["object with indices", () => ({ 0: "zero", 1: "one", length: 2 })],
    ["arguments", () => (function (..._: number[]) { return arguments; })(5, 6, 7)],
    ["number", () => 5],
    ["Map", () => new Map([[0, 1]])],
];
const indices: number[] = unseen([0, 1, 2, 3, 4, -1, 100, 1.5, 4294967296, 2147483648, -2147483648, NaN, Infinity, -0]);
const keys: unknown[] = unseen([0, 3, "1", "length", "x", 1.0, -0, null, undefined, true, Symbol.iterator, { toString(): string { return "2"; } }, 4294967295, "4294967296"]);
const stored: unknown[] = unseen([7, -1, 300, 1.5, NaN, -0, 2147483648, "8", null, undefined, true, { valueOf(): number { return 6; } }]);

const list = (v: unknown): string => (typeof v === "object" && v !== null ? Object.keys(v).slice(0, 12).map(k => k + ":" + show((v as Record<string, unknown>)[k])).join("/") + "#" + show((v as { length?: unknown }).length) : show(v));
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return (e as Error).constructor.name; } }
for (const [name, make] of kinds) {
    const holder = (): Holder => unseen({ ints: make(), bytes: make(), numbers: make() } as unknown as Holder);
    const spread = (): Holder => ({ ...holder() });
    const h = spread();
    console.log(name, "read", indices.map(i => [attempt(() => readInt(h, i)), attempt(() => readByte(h, i)), attempt(() => readNumber(h, i))].join()).join(" "));
    console.log(name, "read by value", keys.map(k => [attempt(() => readIntByValue(h, k)), attempt(() => readNumberByValue(h, k))].join()).join(" "));
    const out: string[] = [];
    for (const v of stored) {
        const w = spread();
        for (const i of indices) { out.push(attempt(() => storeInt(w, i, v as number)), attempt(() => storeByte(w, i, v as number)), attempt(() => storeNumber(w, i, v as number))); }
        out.push(attempt(() => list(w.ints)), attempt(() => list(w.bytes)), attempt(() => list(w.numbers)));
    }
    console.log(name, "store", out.filter(x => x !== "undefined").join(" "));
    const byValue: string[] = [];
    for (const k of keys) { const w = spread(); byValue.push(attempt(() => storeIntByValue(w, k, 11)), attempt(() => storeNumberByValue(w, k, 2.5)), attempt(() => list(w.ints)), attempt(() => list(w.numbers))); }
    console.log(name, "store by value", byValue.filter(x => x !== "undefined").join(" "));
}
resizable.buffer.resize(8);
const later: Holder = { ...unseen({ ints: tracked, bytes: new Uint8Array(resizable.buffer), numbers: [1.5] }) };
console.log(indices.map(i => attempt(() => readInt(later, i)) + "," + attempt(() => readByte(later, i))).join(" "));
console.log(log.length, log.slice(0, 12).join());
