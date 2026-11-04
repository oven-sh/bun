// handed to code out of sight
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
(globalThis as any).spoil = function (l: any[]) { l.push("spoiled"); l[0] = 5; };
const list: N[] = []; list.push({ v: 1 });
{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(list[i])); out.push(got.join()); }
(globalThis as any).spoil(list);
{ const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
