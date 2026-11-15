class Item { n = 1; }
const above: any = { n: 7 };
class Below extends Array<any> { set undefined(v: any) { above.n = v.n + 100; } get undefined(): any { return above; } }
const on: boolean = JSON.parse("true");
const queue: number[] = on ? [] : [0];
const r: Item[] = [new Item()].slice() as Item[];
const stored = new Item(); stored.n = 5;
r[queue.shift()!] = stored;
console.log("SAID", r[0]?.n, (r as any)["undefined"]?.n, r[queue.pop()!]?.n, Object.keys(r).join(), above.n, r.length);
export {};
