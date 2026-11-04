// an own push
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 });
(list as any).push = function (x: any) { Array.prototype.push.call(this, "own push took " + x.v); return 0; };
list.push({ v: 2 });
{ const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(list[i])); out.push(got.join()); }
console.log(out.join(" | "));
