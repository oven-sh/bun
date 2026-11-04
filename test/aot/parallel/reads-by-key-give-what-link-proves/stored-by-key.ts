// stored by key
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }, { v: 2 });
(list as any)[1] = "a text"; (list as any)[hidden<number>("3")] = 9; (list as any)[hidden<string>('"0"')] = false;
{ const got: string[] = []; for (let i = 0; i < hidden<number>("5"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
