declare const process: { readonly argv: readonly string[] };
export {};
const n = Number(process.argv[2] ?? "3");
const out: string[] = [];
const say = (name: string, v: unknown): void => { out.push(name + " " + (Object.is(v, -0) ? "-0" : String(v)) + " " + typeof v); };
class Half { constructor(readonly whole: number) {} get value(): number { return this.whole * 0.5; } }
function direct(h: Half): number { return h.value + h.value; }
say("direct", direct(new Half(n)));
class Odd { constructor(readonly kind: number) {} get value(): number | undefined { switch (this.kind) { case 0: return NaN; case 1: return -0; case 2: return 7; case 3: return 1e308 * 10; case 4: return undefined; case 5: return 0.1 + 0.2; default: return -2147483649; } } }
function ofOdd(o: Odd): number | undefined { return o.value; }
for (let k = 0; k < 7; k++) { say("odd", ofOdd(new Odd((k + n) % 7))); say("odd unknown", (new Odd((k + n) % 7) as any).value); }
console.log(out.join("\n"));
