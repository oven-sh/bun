type Rec = { b: string };
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzThrowsWhenRead", { get() { throw new RangeError("from the getter"); }, enumerable: true }); return made; }
function find(o: any): any { try { return Object.values(o).length; } catch (e: any) { return e.constructor.name + ": " + e.message; } }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(got);
