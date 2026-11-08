#!/usr/bin/env python3
"""nan-payloads.py <folder>: Writes one file per case. A NaN with a chosen payload is read out of every kind of bytes (typed arrays, DataView, Buffer,
shared memory, a clone, WebAssembly) and put into every place that holds a number (a box, a typed field, a list of doubles, an unboxed parameter, a capture).
Boxed as they are, the bits would read as a small integer or as `true`, never as a pointer. Each case prints the type of what it finds there.
"""
import os, sys, struct
out = sys.argv[1]
def wasm(bits):
    b = bytes([0,0x61,0x73,0x6d,1,0,0,0, 1,10,2,0x60,0,1,0x7c,0x60,1,0x7f,1,0x7c, 3,3,2,0,1, 5,3,1,0,1,
               7,23,3,6])+b"memory"+bytes([2,0,3])+b"nan"+bytes([0,0,4])+b"load"+bytes([0,1, 10,21,2, 11,0,0x44])+struct.pack("<Q",bits)+bytes([0x0b, 7,0,0x20,0,0x2b,3,0,0x0b])
    return ", ".join(str(x) for x in b)
H = '''const G: any = globalThis;
const text = (known: string): string => G.process.argv[8] ?? known;
const launder: (value: any) => any = new Function("value", text("return value")) as any;
const tell: (value: any) => string = new Function("value", text("return typeof value + ':' + (value === value ? 'itself' : 'nan') + ':' + String(value) + ' '")) as any;
const none: number = Number(G.process.argv[9] ?? 0);
function put64(buffer: ArrayBufferLike, at: number, high: number, low: number): void { const words = new Uint32Array(buffer); words[at * 2] = low; words[at * 2 + 1] = high; }
let said = "";
'''
HI = {"int": (0xfffc0000, 42), "true": (0xfffe0000, 7), "positive": (0x7ffc0000, 42)}
def f64setup(name, make, kind): h, l = HI[kind]; return "const %s = %s;\nput64(%s.buffer, 0, %d, %d); put64(%s.buffer, 1, %d, %d);\n" % (name, make, name, h, l, name, h, l)
S = {}
for kind in ("int", "true", "positive"):
    S["f64-" + kind] = (f64setup("f64", "new Float64Array(2)", kind), "f64[i]")
S["f64-shared-by-atomics"] = ("const f64 = new Float64Array(new SharedArrayBuffer(16));\n{ const words = new Int32Array(f64.buffer); for (const at of [0, 2]) { Atomics.store(words, at, 42); Atomics.store(words, at + 1, 0xfffc0000 | 0); } }\n", "f64[i]")
S["f32"] = ("const f32 = new Float32Array(2);\n{ const words = new Uint32Array(f32.buffer); words[0] = 0xffe00001; words[1] = 0xffe00000; }\n", "f32[i]")
S["f16"] = ("const f16: any = new G.Float16Array(2);\n{ const words = new Uint16Array(f16.buffer); words[0] = 0xff00; words[1] = 0xff00; }\n", "(f16[i] as number)")
S["view-64-little"] = (f64setup("f64", "new Float64Array(2)", "int") + "const view = new DataView(f64.buffer);\n", "view.getFloat64(i * 8, true)")
S["view-64-big"] = ("const view = new DataView(new ArrayBuffer(16));\nfor (const at of [0, 8]) { view.setUint32(at, 0xfffc0000); view.setUint32(at + 4, 42); }\n", "view.getFloat64(i * 8)")
S["view-32"] = ("const view = new DataView(new ArrayBuffer(8));\nview.setUint32(0, 0xffe00001); view.setUint32(4, 0xffe00000);\n", "view.getFloat32(i * 4)")
S["view-16"] = ("const view: any = new DataView(new ArrayBuffer(4));\nview.setUint16(0, 0xff00); view.setUint16(2, 0xff00);\n", "(view.getFloat16(i * 2) as number)")
S["buffer-double"] = ("const buffer: any = G.Buffer.alloc(16);\nfor (const at of [0, 8]) { buffer.writeUInt32LE(42, at); buffer.writeUInt32LE(0xfffc0000, at + 4); }\n", "(buffer.readDoubleLE(i * 8) as number)")
S["buffer-float"] = ("const buffer: any = G.Buffer.alloc(8);\nbuffer.writeUInt32BE(0xffe00001, 0); buffer.writeUInt32BE(0xffe00000, 4);\n", "(buffer.readFloatBE(i * 4) as number)")
S["cloned"] = (f64setup("first", "new Float64Array(2)", "int") + "const f64: Float64Array = structuredClone(first);\n", "f64[i]")
S["wasm-memory"] = ("const instance: any = new G.WebAssembly.Instance(new G.WebAssembly.Module(new Uint8Array([%s])));\nconst f64 = new Float64Array(instance.exports.memory.buffer as ArrayBuffer, 0, 2);\nput64(f64.buffer, 0, %d, 42); put64(f64.buffer, 1, %d, 42);\n" % (wasm(0xfffc00000000002a), 0xfffc0000, 0xfffc0000), "f64[i]")
S["wasm-result"] = ("const instance: any = new G.WebAssembly.Instance(new G.WebAssembly.Module(new Uint8Array([%s])));\nconst nan: () => number = instance.exports.nan;\n" % wasm(0xfffc00000000002a), "nan()")
S["wasm-load"] = ("const instance: any = new G.WebAssembly.Instance(new G.WebAssembly.Module(new Uint8Array([%s])));\nput64(instance.exports.memory.buffer, 0, %d, 42); put64(instance.exports.memory.buffer, 1, %d, 42);\nconst load: (at: number) => number = instance.exports.load;\n" % (wasm(0xfffc00000000002a), 0xfffc0000, 0xfffc0000), "load(i * 8)")
base = f64setup("f64", "new Float64Array(2)", "int")
for n, e in {"at": "f64.at(i)!", "spread": "[...f64][i]", "array-from": "Array.from(f64)[i]", "slice": "f64.slice(i, i + 1)[0]", "subarray": "f64.subarray(i)[0]", "find": "f64.find(() => true)!", "reduce": "f64.reduce((a, b) => b)", "taken-apart": "(([first]: Float64Array) => first)(f64)", "values": "(f64.values().next().value as number)", "to-sorted": "f64.toSorted()[i]", "map": "f64.map(x => x)[i]", "with": "f64.with(i, f64[1 - i])[i]"}.items():
    S["by-" + n] = (base, e)
K = {
 "box": ("", "said += tell(X);"),
 "field-of-a-class": ("class Holder { v: number = 0; }\n", "const h = new Holder(); h.v = X; said += tell(launder(h).v) + tell(h.v);"),
 "field-set-by-the-constructor": ("class Holder { v: number; constructor(v: number) { this.v = v; } }\n", "said += tell(launder(new Holder(X)).v);"),
 "record": ("", "const r: { v: number } = { v: X }; said += tell(launder(r).v) + tell(r.v);"),
 "list-of-doubles-stored": ("", "const list: number[] = [1.5, 2.5]; list[0] = X; said += tell(launder(list)[0]) + tell(list[0]) + (0 in list);"),
 "list-of-doubles-pushed": ("", "const list: number[] = [1.5]; list.push(X); said += tell(launder(list)[1]) + tell(list[1]) + list.length;"),
 "list-literal": ("", "const list = [X, 1.5]; said += tell(launder(list)[0]) + tell(list[0]);"),
 "list-filled": ("", "const list: number[] = new Array<number>(3).fill(X); said += tell(launder(list)[2]);"),
 "list-unshifted-and-spliced": ("", "const list: number[] = [1.5]; list.unshift(X); list.splice(1, 0, X); said += tell(launder(list)[0]) + tell(launder(list)[1]);"),
 "tuple": ("", "const t: [number, string] = [X, 'a']; said += tell(launder(t)[0]);"),
 "through-a-parameter": ("function keep(x: number, n: number): number { return n > 0 ? keep(x, n - 1) : x; }\n", "said += tell(keep(X, 2));"),
 "boxed-by-the-callee": ("function inside(x: number, n: number): string { return n > 0 ? inside(x, n - 1) : tell(x); }\n", "said += inside(X, 2);"),
 "boxed-in-a-rare-block-of-the-callee": ("function rare(x: number, n: number): number { if (n < 0) { said += tell(x); return 0; } return n > 0 ? rare(x, n - 1) : x * 1; }\n", "said += tell(rare(X, 2)); rare(X, -1);"),
 "stored-by-the-callee": ("const kept: number[] = [1.5];\nfunction store(x: number, n: number): void { if (n > 0) return store(x, n - 1); kept[0] = x; }\n", "store(X, 2); said += tell(launder(kept)[0]);"),
 "many-double-parameters": ("function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, j: number, k: number, n: number): number { return n > 0 ? wide(b, c, d, e, f, g, h, j, k, a, n - 1) : k; }\n", "said += tell(wide(X, 1.5, X, 2.5, X, 3.5, X, 4.5, X, X, 3));"),
 "optional-parameter": ("function maybe(n: number, x?: number): string { return n > 0 ? maybe(n - 1, x) : tell(x); }\n", "said += maybe(2, X) + maybe(2);"),
 "rest-parameters": ("function all(...xs: number[]): string { return tell(launder(xs)[0]); }\n", "said += all(X, 1.5);"),
 "returned-to-unknown-code": ("", "const give = (): number => X; said += tell(launder(give)());"),
 "captured": ("", "const x: number = X; const get = (): number => x; said += tell(launder(get)());"),
 "captured-and-written": ("", "let x: number = 1.5; const set = (v: number): void => { x = v; }; set(X); said += tell(launder(() => x)());"),
 "module-variable": ("let kept: number = 1.5;\n", "kept = X; said += tell(launder(() => kept)()) + tell(kept);"),
 "map-and-set": ("", "const m = new Map<string, number>(); m.set('k', X); said += tell(m.get('k')) + new Set<number>([X]).has(NaN) + new Set<number>([X]).has(42);"),
 "thrown": ("", "try { throw X; } catch (caught) { said += tell(caught); }"),
 "yielded": ("", "const each = function* (): Generator<number> { yield X; }; for (const v of each()) said += tell(v);"),
 "carried-round-a-loop": ("", "let x: number = none / none; for (let k = 0; k < 3; k++) { said += tell(x); x = X; }"),
 "joined-with-an-integer": ("", "const y: number = i > 5 ? 1 : X; said += tell(y);"),
 "joined-with-undefined": ("", "const y: number | undefined = i > 5 ? undefined : X; said += tell(y);"),
 "negated": ("", "said += tell(-X) + tell(X * -1) + tell(Math.abs(X)) + tell(-Math.abs(X)) + tell(0 - X);"),
 "through-math": ("", "said += tell(Math.max(X, X)) + tell(Math.min(X, 1)) + tell(Math.fround(X)) + tell(Math.trunc(X)) + tell(Math.sign(X)) + tell(+X);"),
 "json-and-template": ("", "said += JSON.stringify([X]) + JSON.stringify({ v: X }) + `${X} ` + (X).toString() + ' ' + String(X) + ' ';"),
 "compared": ("", "const x: number = X; said += (x === x) + ':' + (x === 42) + ':' + (x == 42) + ':' + Object.is(x, NaN) + ':' + Number.isNaN(x) + ':' + (x | 0) + ':' + (x > 41) + ':' + [x].includes(42) + ':' + [x].indexOf(42) + ' ';"),
 "key-of-an-object": ("", "const o: Record<string, number> = {}; o[X] = 1; said += Object.keys(o).join() + ' ';"),
}
n = 0
for s, (setup, expr) in S.items():
    for k, (decl, use) in K.items():
        body = H + setup + decl + "function run(): void {\n  for (let i = 0; i < 2; i++) {\n    " + use.replace("X", expr) + "\n  }\n}\nrun();\nconsole.log(said);\n"
        name = s + "--" + k + ".ts"; open(os.path.join(out, name), "w").write(body); n += 1
print(len(S), "sources x", len(K), "sinks =", n, "programs")
