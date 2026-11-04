// destructured and iterated
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: any[] = []; list.push({ v: 1 }, "two", 3);
const [x, y, z, w] = list; out.push(say(x), say(y), say(z), say(w));
for (const e of list) out.push(say(e)); for (const [i, e] of list.entries()) out.push(i + say(e));
(list as any)[Symbol.iterator] = function* () { yield "from another iterator"; };
for (const e of list) out.push(say(e));
{ const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
