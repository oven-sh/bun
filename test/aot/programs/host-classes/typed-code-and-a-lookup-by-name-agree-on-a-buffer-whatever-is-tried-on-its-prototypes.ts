// Code that declares a Buffer or a Uint8Array finds `length` and the methods without a lookup. Whatever a program tries on the three prototypes, and whether or not the
// attempt is refused, that code answers what a lookup by name answers.
const seen = new Function("value", "return value" + String(process.argv.length).slice(9)) as <V>(value: V) => V;
function read(b: Buffer): unknown { return b.readUInt8(0); }
function word(b: Buffer): unknown { return b.readUInt32LE(0); }
function length(b: Buffer): unknown { return b.length; }
function lengthOfView(b: Uint8Array): unknown { return b.length; }
function bytesOfView(b: Uint8Array): unknown { return b.byteLength; }
function sum(b: Buffer): unknown { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]!; return s; }
function readByName(b: any): unknown { return b.readUInt8(0); }
function wordByName(b: any): unknown { return b.readUInt32LE(0); }
function lengthByName(b: any): unknown { return b.length; }
function bytesByName(b: any): unknown { return b.byteLength; }
function sumByName(b: any): unknown { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]; return s; }
const makeBuffer = seen(() => Buffer.from([5, 6, 7, 8]));
const makeView = seen(() => new Uint8Array([5, 6, 7, 8]));
function answer(run: (b: any) => unknown, make: () => unknown): string {
  try { return String(run(make())); } catch (error) { return (error as Error).name; }
}
const pairs: [string, (b: any) => unknown, (b: any) => unknown, () => unknown][] = [
  ["readUInt8", read, readByName, makeBuffer], ["readUInt32LE", word, wordByName, makeBuffer], ["length", length, lengthByName, makeBuffer], ["sum", sum, sumByName, makeBuffer],
  ["length of a Buffer as a view", lengthOfView, lengthByName, makeBuffer], ["length of a view", lengthOfView, lengthByName, makeView],
  ["byteLength of a Buffer as a view", bytesOfView, bytesByName, makeBuffer], ["byteLength of a view", bytesOfView, bytesByName, makeView],
];
function attempt(what: string, change: () => void): void {
  try { change(); } catch {}
  const apart = pairs.filter(([, typed, byName, make]) => answer(typed, make) !== answer(byName, make)).map(([name]) => name);
  console.log(what, "|", apart.length ? "APART: " + apart.join(", ") : "agree");
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
attempt("nothing", () => {});
attempt("store Buffer.prototype.readUInt8", () => { (Buffer.prototype as any).readUInt8 = function () { return -1; }; });
attempt("define Buffer.prototype.readUInt32LE", () => { Object.defineProperty(Buffer.prototype, "readUInt32LE", { value() { return -2; }, configurable: true }); });
attempt("define Buffer.prototype.length", () => { Object.defineProperty(Buffer.prototype, "length", { get() { return 2; }, configurable: true }); });
attempt("store Buffer.prototype.length", () => { (Buffer.prototype as any).length = 3; });
attempt("define Uint8Array.prototype.length", () => { Object.defineProperty(Uint8Array.prototype, "length", { get() { return 1; }, configurable: true }); });
attempt("define Uint8Array.prototype.byteLength", () => { Object.defineProperty(Uint8Array.prototype, "byteLength", { get() { return 94; }, configurable: true }); });
attempt("define %TypedArray%.prototype.length", () => { Object.defineProperty(typedArrayPrototype, "length", { get() { return 3; }, configurable: true }); });
attempt("Reflect.set on Buffer.prototype", () => { Reflect.set(Buffer.prototype, "readUInt8", () => -3); });
attempt("Reflect.defineProperty on Buffer.prototype", () => { Reflect.defineProperty(Buffer.prototype, "length", { value: 1, configurable: true }); });
attempt("Object.assign on Buffer.prototype", () => { Object.assign(Buffer.prototype, { readUInt8() { return -4; } }); });
attempt("Buffer.prototype below another", () => { Object.setPrototypeOf(Buffer.prototype, Object.create(Uint8Array.prototype, { length: { get() { return 2; } } })); });
attempt("Uint8Array.prototype below another", () => { Object.setPrototypeOf(Uint8Array.prototype, Object.create(typedArrayPrototype, { length: { get() { return 1; } } })); });
attempt("__proto__ of Buffer.prototype", () => { (Buffer.prototype as any).__proto__ = { get length() { return 0; } }; });
attempt("delete Buffer.prototype.readUInt8", () => { delete (Buffer.prototype as any).readUInt8; });
attempt("delete Buffer.prototype.length", () => { delete (Buffer.prototype as any).length; });
attempt("delete Uint8Array.prototype.length", () => { delete (Uint8Array.prototype as any).length; });
attempt("delete %TypedArray%.prototype.length", () => { delete typedArrayPrototype.length; });
attempt("delete %TypedArray%.prototype.byteLength", () => { delete typedArrayPrototype.byteLength; });
