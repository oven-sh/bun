declare const process: { readonly argv: readonly string[] };
export {};
const n = Number(process.argv[2] ?? "3");
const out: string[] = [];
const say = (name: string, v: unknown): void => { out.push(name + " " + (Object.is(v, -0) ? "-0" : String(v)) + " " + typeof v); };
class Half { constructor(readonly whole: number) {} get value(): number { return this.whole * 0.5; } }
function direct(h: Half): number { return h.value + h.value; }
say("direct", direct(new Half(n)));
class Below extends Half { get value(): number { return super.value + 100; } }
function below(b: Below): number { return b.value; }
say("super", below(new Below(n)));
say("as the class above", direct(new Below(n)));
console.log(out.join("\n"));
