// Byte arrays alone come where Buffer is written, and nobody changes them: they keep their own names, not Buffer's.
const told = (label: string, f: () => any): void => { let line = label + " "; try { const v = f(); line += typeof v === "function" ? "function " + v.name : String(v); } catch (e) { line += "throws " + (e as any).name; } console.log(line); };
function readsToJSON(x: Buffer): any { return (x as any).toJSON; }
told("toJSON", () => readsToJSON(new Uint8Array([65, 66]) as any));
function kindOfToJSON(x: Buffer): any { return typeof x.toJSON; }
told("typeof toJSON", () => kindOfToJSON(Uint8Array.from([65]) as any));
function callsToJSON(x: Buffer): any { let r: any; for (let i = 0; i < 4; i++) r = JSON.stringify(x.toJSON()); return r; }
told("toJSON()", () => callsToJSON(new Uint8Array(3) as any));
function slices(x: Buffer): any { return x.slice === (Uint8Array.prototype.slice as any) ? "a view's" : x.slice === Buffer.prototype.slice ? "a Buffer's" : "another"; }
told("slice", () => slices(new Uint8Array([1, 2]) as any));
for (let i = 0; i < 3; i++) told("slice " + i, () => slices(new Uint8Array([1, i]) as any));
function named(x: Buffer): any { return x.constructor.name; }
for (let i = 0; i < 3; i++) told("named", () => named(Uint8Array.of(i) as any));
function texts(x: Buffer): any { return x.toString("latin1") + "/" + x.toString() + "/" + x.toLocaleString() + "/" + (x as any).toJSON; }
told("texts", () => texts(new TextEncoder().encode("ab") as any));
function both(x: Buffer): any { const before = x.toJSON, part = x.slice(1); part[0] = 9; return typeof before + x[1] + part.constructor.name + x.toString(); }
told("both", () => both(new Uint8Array([1, 2, 3]) as any));
function inLoop(x: Buffer): any { let r = ""; for (let i = 0; i < 4; i++) r += typeof x.toJSON + typeof x.equals + x.constructor.name; return r; }
told("in a loop", () => inLoop(new Uint8Array([1, 2, 3]) as any));
const kept: Buffer = new Uint8Array([7, 8]) as any;
told("a constant", () => typeof kept.toJSON + kept.toString("hex") + kept.constructor.name);
let changed: Buffer = new Uint8Array([7, 8]) as any;
told("a variable", () => typeof changed.toJSON + changed.toString("hex") + changed.constructor.name);
changed = new Uint8Array([9]) as any;
told("a variable", () => typeof changed.toJSON + changed.toString("hex") + changed.slice(0).constructor.name);
function bytes(x: Uint8Array): any { return (x as any).toJSON().data.join() + x.slice(1).constructor.name + x.toString() + x.constructor.name; }
told("a Buffer", () => bytes(Buffer.from([65, 66])));
told("a Buffer", () => bytes(Buffer.alloc(2)));
class Holder { constructor(public x: Buffer) {} use(): any { return typeof this.x.toJSON + this.x.toString("hex") + this.x.slice(0).constructor.name; } }
told("a field", () => new Holder(new Uint8Array([1]) as any).use());
export {};
