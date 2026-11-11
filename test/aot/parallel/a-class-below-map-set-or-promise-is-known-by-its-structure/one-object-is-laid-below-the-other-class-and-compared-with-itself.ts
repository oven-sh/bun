declare const process: { readonly argv: readonly string[] };
const far = (v: unknown): any => [v][JSON.parse("0")];
const turns = Number(process.argv[2] ?? 300); let sum = 0;
class H extends Map<string, number> { m?: number; hue(): number { return 1; } mark(): void { this.m = 5; } }
class K extends Map<string, number> { q?: number; kay(): number { return 2; } note(): void { this.q = 7; } }
const h = new H(), k = new K(); h.mark(); k.note();
function f(a: H, b: K): number { let n = 0; for (let i = 0; i < 16; i++) { const x = a.hue(); Object.setPrototypeOf(a, K.prototype); const y = b.kay(); if ((a as unknown) === b) n += x + y; Object.setPrototypeOf(a, H.prototype); } return n; }
for (let t = 0; t < turns; t++) sum += f(far(h), far(h));
console.log(sum, k.q);
export {};
