// a getter on the index
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }, { v: 2 }, { v: 3 });
let gets = 0; Object.defineProperty(list, 1, { get() { gets++; return "got"; }, configurable: true });
{ const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(list[i])); out.push(got.join()); } out.push(String(gets));
console.log(out.join(" | "));
