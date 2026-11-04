// a list returned by a function
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
function make(kind: number): any[] { const l: any[] = []; l.push(kind ? "text " + kind : { v: kind }); return l; }
const a = make(0), b = make(1);
{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(a[i])); out.push(got.join()); }{ const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(b[i])); out.push(got.join()); }
console.log(out.join(" | "));
