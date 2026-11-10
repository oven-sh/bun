declare const process: { readonly argv: readonly string[] };
export {};
const n = Number(process.argv[2] ?? "3");
const out: string[] = [];
const say = (name: string, v: unknown): void => { out.push(name + " " + (Object.is(v, -0) ? "-0" : String(v)) + " " + typeof v); };
class Half { constructor(readonly whole: number) {} get value(): number { return this.whole * 0.5; } }
function direct(h: Half): number { return h.value + h.value; }
say("direct", direct(new Half(n)));
const key = ["val", "ue"].join("");
say("key", (new Half(n) as any)[key]);
for (const k of [key, "whole", "none"]) say("keys", (new Half(n + 1) as any)[k]);
console.log(out.join("\n"));
