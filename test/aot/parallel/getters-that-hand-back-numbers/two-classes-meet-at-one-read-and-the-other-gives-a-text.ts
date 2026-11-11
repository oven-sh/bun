declare const process: { readonly argv: readonly string[] };
export {};
const n = Number(process.argv[2] ?? "3");
const out: string[] = [];
const say = (name: string, v: unknown): void => { out.push(name + " " + (Object.is(v, -0) ? "-0" : String(v)) + " " + typeof v); };
class Half { constructor(readonly whole: number) {} get value(): number { return this.whole * 0.5; } }
function direct(h: Half): number { return h.value + h.value; }
say("direct", direct(new Half(n)));
class Named { constructor(readonly whole: number) {} get value(): string { return "n" + this.whole; } }
function either(c: boolean): Half | Named { return c ? new Half(n) : new Named(n); }
for (let i = 0; i < 4; i++) say("either", either((i + n) % 2 === 0).value);
console.log(out.join("\n"));
