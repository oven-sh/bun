// in a field of an object that leaves
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
class Holder { list: N[] = []; }
const h = new Holder(); h.list.push({ v: 1 }); (globalThis as any).kept = h;
(globalThis as any).reach = function () { (globalThis as any).kept.list.push("reached"); };
function read(x: Holder) { { const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(x.list[i])); out.push(got.join()); } }
read(h); (globalThis as any).reach(); read(h);
console.log(out.join(" | "));
