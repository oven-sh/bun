declare const process: { readonly argv: readonly string[] };
export {};
const n = Number(process.argv[2] ?? "3");
const out: string[] = [];
const say = (name: string, v: unknown): void => { out.push(name + " " + (Object.is(v, -0) ? "-0" : String(v)) + " " + typeof v); };
class Half { constructor(readonly whole: number) {} get value(): number { return this.whole * 0.5; } }
function direct(h: Half): number { return h.value + h.value; }
say("direct", direct(new Half(n)));
const getter = Object.getOwnPropertyDescriptor(Half.prototype, "value")!.get!;
say("call", getter.call(new Half(n)));
say("apply", getter.apply({ whole: n + 2 }, []));
const bound = getter.bind(new Half(n + 4));
say("bound", bound());
console.log(out.join("\n"));
