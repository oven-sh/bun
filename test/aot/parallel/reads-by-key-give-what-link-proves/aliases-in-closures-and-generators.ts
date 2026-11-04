// aliases in closures and generators
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
function make() { const list: any[] = []; return { add: (x: any) => list.push(x), at: (i: number) => say(list[i]), *each() { for (let i = 0; i < list.length; i++) yield say(list[i]); } }; }
const one = make(), two = make(); one.add({ v: 1 }); two.add("text"); one.add(2);
out.push(one.at(0), one.at(1), one.at(2), two.at(0), two.at(1), [...one.each()].join(), [...two.each()].join());
console.log(out.join(" | "));
