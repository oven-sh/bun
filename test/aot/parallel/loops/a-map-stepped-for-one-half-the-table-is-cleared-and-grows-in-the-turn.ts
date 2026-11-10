const said: unknown[] = [];
const q = Number(process.argv[2] ?? 3);
const table = new Map<string, number>(); for (let i = 0; i < 8; i++) table.set('k' + i, i * q);
let s = 0, turns = 0; for (const value of table.values()) { turns++; s += value; if (turns === 3) { table.clear(); for (let i = 0; i < 40; i++) table.set('n' + i, i); } if (turns > 100) break; } said.push(s, turns, table.size);
console.log(said.join(' | '));
