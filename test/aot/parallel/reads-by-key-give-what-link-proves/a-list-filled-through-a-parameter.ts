// a list filled through a parameter
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
function add(to: any[], what: any) { to.push(what); }
const a: any[] = [], b: any[] = []; add(a, { v: 1 }); add(b, "a text"); add(a, 2n);
{ const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(a[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(b[i])); out.push(got.join()); }
console.log(out.join(" | "));
