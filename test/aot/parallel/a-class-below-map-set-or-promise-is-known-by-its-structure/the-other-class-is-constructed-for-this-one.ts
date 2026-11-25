declare const process: { readonly argv: readonly string[] };
const far = (v: unknown): any => [v][JSON.parse("0")];
const turns = Number(process.argv[2] ?? 300); let sum = 0;
class H extends Map<string, number> { hue(): number { return 1; } }
class K extends Map<string, number> { static last: K | null = null; constructor() { super(); K.last = this; } kay(): number { return 2; } }
const real = new K();
function f(a: H, b: K | null): number { let n = 0; for (let i = 0; i < 16; i++) { n += a.hue(); if ((a as unknown) === b) n += 10; } return n; }
for (let t = 0; t < turns; t++) { const made = Reflect.construct(K, [], H); sum += f(far(made), K.last); }
console.log("SAID", sum, real.kay());
export {};
