// pushes in a loop
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const nodes: N[] = [];
for (let i = 0; i < 8; i++) nodes.push(i & 1 ? { v: i } : { v: i, tag: "even" });
let total = 0; for (let i = 0; i < 64; i++) { const n = nodes[i & 7]; n.tag = "seen"; total += n.v; }
out.push(String(total));
{ const got: string[] = []; for (let i = -1; i < hidden<number>("9"); i++) got.push(say(nodes[i])); out.push(got.join()); }
console.log(out.join(" | "));
