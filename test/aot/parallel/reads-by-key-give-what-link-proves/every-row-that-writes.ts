// every row that writes
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const rows: Array<(l: any[]) => void> = [l => l.unshift("unshift"), l => l.splice(1, 0, "splice"), l => l.fill("fill", 0, 1), l => l.copyWithin(0, 1, 2), l => l.reverse(), l => l.sort(() => -1), l => { l.length = 1; }, l => l.pop(), l => l.shift(),
  l => Object.assign(l, { 0: "assign" }), l => Reflect.set(l, 0, "reflect"), l => Object.defineProperty(l, 0, { value: "defined", writable: true, enumerable: true, configurable: true }), l => { delete l[0]; }, l => l.push(...["spread", 5]), l => { [l[0], l[1]] = [l[1], "swapped"]; }];
for (const row of rows) { const l: N[] = []; l.push({ v: 1 }, { v: 2 }); row(l); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(l[i])); out.push(got.join()); } }
console.log(out.join(" | "));
