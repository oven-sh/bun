interface Leaf { a: number; b: number; c: number; d: number; e: number; f: number; g: number; next: Leaf | undefined; }
interface Big { a: number; b: number; c: number; d: number; e: number; f: number; g: number; leaf: Leaf; }
interface Holder { state: Big; name: string; }
function sum(holder: Holder): number { return holder.state ? holder.state.a + holder.state.leaf.g : -1; }
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data, data.leaf); return data; }
function outside(n: number): any { return keep(JSON.parse(`{"a":${n},"b":1,"c":2,"d":3,"e":4,"f":5,"g":6,"leaf":{"a":1,"b":1,"c":2,"d":3,"e":4,"f":5,"g":${n}}}`)); }
const holders: Holder[] = [{ state: outside(1), name: "in a literal" }, { state: undefined!, name: "stored" }];
holders[1].state = outside(2);
for (const holder of holders) console.log(holder.name, sum(holder), holder.state === kept[holder.name === "stored" ? 2 : 0], holder.state.leaf === kept[holder.name === "stored" ? 3 : 1]);
