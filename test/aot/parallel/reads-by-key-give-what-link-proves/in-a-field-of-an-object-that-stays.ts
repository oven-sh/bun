// in a field of an object that stays
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
class Holder { list: any[] = []; add(x: any) { this.list.push(x); } }
const h = new Holder(), other = new Holder(); h.add({ v: 1 }); h.add("a text"); other.add(0.5);
function read(x: Holder) { { const got: string[] = []; for (let i = 0; i < hidden<number>("3"); i++) got.push(say(x.list[i])); out.push(got.join()); } }
read(h); read(other);
console.log(out.join(" | "));
