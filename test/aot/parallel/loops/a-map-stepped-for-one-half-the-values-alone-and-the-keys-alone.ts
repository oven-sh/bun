const said: unknown[] = [];
const q = Number(process.argv[2] ?? 3);
const table = new Map<string, number>(); for (let i = 0; i < 8; i++) table.set('k' + i, i * q);
let s = 0; for (const value of table.values()) s += value; let t = ''; for (const key of table.keys()) t += key; said.push(s, t);
console.log(said.join(' | '));
