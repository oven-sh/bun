const said: unknown[] = [];
const q = Number(process.argv[2] ?? 3);
const table = new Map<string, number>(); for (let i = 0; i < 8; i++) table.set('k' + i, i * q);
const mixed = new Map<unknown, unknown>([[1, 'one'], ['two', 2], [null, undefined], [undefined, null], [NaN, -0], [{ a: q }, [q]]]);
for (const value of mixed.values()) said.push(typeof value, String(value)); for (const key of mixed.keys()) said.push(typeof key, Object.is(key, NaN));
console.log(said.join(' | '));
