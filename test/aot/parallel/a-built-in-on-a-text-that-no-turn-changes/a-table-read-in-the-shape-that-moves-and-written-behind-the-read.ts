const list: string[] = []; for (let i = 0; i < 12; i++) list.push("name" + (i % 3));
const table = new Map<string, string>([["k", "name0"]]);
function count(key: string, from: number): number { let n = from; for (let i = 0; i < list.length; i++) { if (list[i] === table.get(key)) n++; table.set(key, "name" + ((i * 2) % 3)); } return n; }
(globalThis as any).kept = count;
console.log(count("k", 0), count("k", 100), count("none", 0));
