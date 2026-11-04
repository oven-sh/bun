// a subclass overrides push
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
class Bag extends Array<any> { push(...items: any[]) { return super.push(...items.map(x => "wrapped " + x.v)); } }
function fill(list: N[]) { for (let i = 0; i < 3; i++) list.push({ v: i }); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(list[i])); out.push(got.join()); } }
fill([]); fill(new Bag() as any);
console.log(out.join(" | "));
