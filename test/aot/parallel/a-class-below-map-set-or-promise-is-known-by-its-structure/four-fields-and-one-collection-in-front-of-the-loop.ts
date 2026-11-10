// In a compiled executable the collector cuts chains of four additions and more: what says which class an object was born of must outlive that.
// COUNT: counter:StructuresOfHeirsRemembered >= 1
// COUNT: counter:StructuresOfHeirsRefused = 0
declare const process: { readonly argv: readonly string[] };
declare const Bun: { gc(force: boolean): void };
const far = (v: unknown): any => [v][JSON.parse("0")];
const turns = Number(process.argv[2] ?? 300); let sum = 0;
class H extends Map<string, number> { a = 1; b = 2; c = 3; d = 4; hue(): number { return this.a + 1; } }
const h = new H();
Bun.gc(true);
function f(a: H): number { let n = 0; for (let i = 0; i < 16; i++) n += a.hue(); return n; }
for (let t = 0; t < turns; t++) sum += f(far(h));
console.log("SAID", sum);
export {};
