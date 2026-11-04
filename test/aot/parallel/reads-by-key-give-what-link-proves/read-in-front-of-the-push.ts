// read in front of the push
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: any[] = [];
for (let i = 0; i < 4; i++) { out.push(say(list[i]) + "/" + say(list[i - 1])); list.push(i & 1 ? "odd " + i : { v: i }); }
console.log(out.join(" | "));
