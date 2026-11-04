// push taken as a value
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const a: N[] = [], b: N[] = [];
a.push({ v: 1 }); b.push({ v: 2 });
const push = a.push; push.call(b, "a text" as any); Array.prototype.push.apply(b, [7 as any]); Reflect.apply(push, b, [true as any]);
{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(a[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = 0; i < hidden<number>("5"); i++) got.push(say(b[i])); out.push(got.join()); }
console.log(out.join(" | "));
