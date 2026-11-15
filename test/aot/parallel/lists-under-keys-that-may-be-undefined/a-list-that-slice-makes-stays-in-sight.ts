class Item { n = 1; }
const above: any = { n: 7 };
class Below extends Array<any> { get undefined(): any { return above; } }
const queue: number[] = [];
const r: Item[] = [new Item()].slice() as Item[];
console.log("SAID", r[queue.shift()!]?.n, r.length);
export {};
