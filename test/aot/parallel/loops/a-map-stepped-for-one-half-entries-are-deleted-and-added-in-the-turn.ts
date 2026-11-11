const said: unknown[] = [];
const q = Number(process.argv[2] ?? 3);
const table = new Map<string, number>(); for (let i = 0; i < 8; i++) table.set('k' + i, i * q);
let s = 0, turns = 0; for (const value of table.values()) { turns++; s += value; if (turns === 2) { table.delete('k3'); table.delete('k0'); table.set('late', 100); } if (turns === 4) table.set('k0', 7); } said.push(s, turns);
let t = ''; for (const key of table.keys()) { t += key + ','; if (key === 'k5') { table.delete('k6'); table.set('last', 1); } } said.push(t);
console.log(said.join(' | '));
