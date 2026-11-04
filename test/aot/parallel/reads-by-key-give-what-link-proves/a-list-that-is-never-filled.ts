// a list that is never filled
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = [];
{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(list[i])); out.push(got.join()); } out.push(String(list.length));
console.log(out.join(" | "));
