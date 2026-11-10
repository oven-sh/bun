const unseen = (x: any): any => [x][JSON.parse("0")];
const held: any = { k: 0 };
const told: string[] = [];
let logged = "";
class Base { b: number; constructor(n: any) { this.b = n; logged += "B" + (new.target === Base) + (new.target === Left); } name(): string { return "base" + this.b; } idle(): number { return 0; } }
class Left extends Base { l = 1; constructor(n: any) { super(n + 1); logged += "L" + this.l; } name(): string { return "left-" + super.name(); } idleToo(): number { return 1; } }
class Other { o = 2; constructor(n: any) { logged += "O" + (new.target === Right) + (new.target === Implicit); } name(): string { return "other" + this.o; } idle(): number { return 2; } }
class Right extends Other { r: number; constructor(n: any) { if (n === 4) throw new RangeError("R"); super(n); this.r = 3; logged += "R" + this.r; } idleToo(): number { return 3; } }
class Implicit extends Other { i = 4; idleToo(): number { return 4; } }
function make(C: any, ...a: any[]): any { held.k = a[0]; return new C(a[0]); }
function ofTwoRows(n: number): string { let out = ""; for (let i = 0; i < n; i++) { try { const f: any = i & 1 ? Left : Right; const got = make(f, ...[i]); out += got.name() + (got instanceof Base) + (got instanceof Other); } catch (e) { out += (e as Error).constructor.name; } } return out; }
function withImplicitConstructor(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const f: any = i & 1 ? Left : Implicit; const got = make(f, ...[i]); out += got.name() + Object.keys(got).join(); } return out; }
function ofOneRow(n: number): string { let out = ""; for (let i = 0; i < n; i++) { const f: any = i & 1 ? Left : Base; const got = make(f, ...[i]); out += got.name() + (got instanceof Left); } return out; }
for (const n of unseen([1, 2, 9]) as number[]) { told.push(ofTwoRows(n) + "|" + withImplicitConstructor(n) + "|" + ofOneRow(n) + "|" + logged); logged = ""; }
console.log(told.join("\n"));
export {};
