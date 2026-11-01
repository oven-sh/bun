// One loop reads lists, Buffers and Uint8Arrays through an interface. It also meets values that are Buffers in an unusual way, or only look like one: each is read as plain Bun reads it.
import vm from "node:vm";
type View = { [at: number]: number; length: number };
function touch(value: number) { return value; }
function digest(view: View): number {
  let all = 0, at = 0;
  while (at < view.length) { all = (Math.imul(all, 31) + touch(view[at]! * 2)) | 0; at += 1 + touch(0); }
  return all;
}
function handOn<T extends View>(view: T): T { return view; }
function attempt(label: string, make: () => View) {
  try { console.log(label, digest(handOn(make()))); } catch (error) { console.log(label, "threw", (error as Error).constructor.name); }
}
function filled(): Buffer { const b = Buffer.alloc(3); b[0] = 1; b[1] = 2; b[2] = 3; return b; }
// What the compiler knows well.
attempt("array", () => [1, 2, 3]);
attempt("doubles", () => [1.5, 2.5, 3.5]);
attempt("buffer", () => filled());
attempt("uint8", () => new Uint8Array([1, 2, 3]));
// A Buffer whose prototype changes.
attempt("prototype null", () => { const b = filled(); Object.setPrototypeOf(b, null); return b; });
attempt("prototype Array.prototype", () => { const b = filled(); Object.setPrototypeOf(b, Array.prototype); return b; });
attempt("prototype of its own", () => { const b = filled(); Object.setPrototypeOf(b, { get length() { return 2; } }); return b; });
// Subclasses.
class BelowBuffer extends Buffer {}
class BelowUint8 extends Uint8Array {}
attempt("below Uint8Array", () => new BelowUint8([1, 2, 3]));
attempt("below Buffer", () => { const b = filled(); Object.setPrototypeOf(b, BelowBuffer.prototype); return b; });
// Another realm.
attempt("other realm", () => vm.runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array);
attempt("other realm's array", () => vm.runInNewContext("[1, 2, 3]") as number[]);
// Methods that ask the constructor for a species.
function withSpecies(species: unknown): Buffer { const b = filled(); Object.defineProperty(b, "constructor", { value: { [Symbol.species]: species } }); return b; }
attempt("map to Float64Array", () => withSpecies(Float64Array).map(x => x));
attempt("filter to Int16Array", () => withSpecies(Int16Array).filter(() => true));
attempt("slice with a species", () => withSpecies(Float32Array).slice(0, 3));
attempt("subarray with a species", () => withSpecies(Float64Array).subarray(0, 0));
attempt("Uint8Array's slice on a Buffer", () => Uint8Array.prototype.slice.call(withSpecies(Float32Array), 0, 3) as Buffer);
attempt("Uint8Array's subarray on a Buffer", () => Uint8Array.prototype.subarray.call(withSpecies(Int8Array), 0, 3) as Buffer);
// What only looks like a Buffer.
attempt("object below Buffer.prototype", () => { const o = Object.create(Buffer.prototype); return o instanceof Buffer ? o : []; });
attempt("proxy", () => new Proxy(filled(), {}));
attempt("cast", () => ({ length: 3, 0: 1, 1: 2, 2: 3 }) as unknown as Buffer);
attempt("arguments", () => (function (..._: number[]) { return arguments as unknown as Buffer; })(1, 2, 3));
// Storage that goes away.
attempt("detached", () => { const b = new Uint8Array(new ArrayBuffer(3)); structuredClone(b.buffer, { transfer: [b.buffer] }); return b; });
attempt("resized", () => { const s = new ArrayBuffer(3, { maxByteLength: 8 }); const b = new Uint8Array(s); s.resize(1); return b; });
