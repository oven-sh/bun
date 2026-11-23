const list: string[] = []; for (let i = 0; i < 12; i++) list.push("name" + (i % 3));
const seen = new Set<string>();
function count(key: string, from: number): number { let n = from; for (let i = 0; i < list.length; i++) { if (seen.has(key)) n++; if (i === 4) seen.add(key); } return n; }
(globalThis as any).kept = count;
console.log(count("k", 0), count("k", 100), count("j", 0));
