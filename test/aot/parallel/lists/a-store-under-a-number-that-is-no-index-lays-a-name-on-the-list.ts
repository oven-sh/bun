class Item { n = 1; }
const first: number[] = [NaN], second: number[] = [NaN];
const r: Item[] = [new Item()];
const stored = new Item(); stored.n = 5;
r[first.pop()!] = stored;
console.log("SAID", r[0]?.n, r[second.pop()!]?.n, r[second.pop()!]?.n, Object.keys(r).join(), r.length);
export {};
