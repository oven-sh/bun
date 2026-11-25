function even(cells: any[]): number { let t = 0; for (let j = 0; j < cells.length; j++) { const cell = cells[j]; if ((cell & 1) === 0) t++; } return t; }
function bits(cells: any[]): string { let a = 0, o = 0, x = 0, n = 0, l = 0, r = 0, u = 0; for (let j = 0; j < cells.length; j++) { a += cells[j] & 5; o += cells[j] | 2; x ^= cells[j]; n += ~cells[j]; l += cells[j] << 2; r += cells[j] >> 1; u += cells[j] >>> 28; } return [a, o, x, n, l, r, u].join(); }
const base = (): any[] => { const l: any[] = []; for (let i = 0; i < 20; i++) l.push(i * 3 + 1); return l; };
console.log(even(base()), bits(base()));
for (const odd of [undefined, null, "7", "x", "", true, 2.5, -0.5, NaN, Infinity, -Infinity, 4294967297, -2147483649, 1e21, {}, [], [9], 5n]) for (const at of [0, 3, 8, 19]) {
  const l = base(); l[at] = odd;
  let said: string; try { said = even(l) + " " + bits(l); } catch (e) { said = (e as Error).name; }
  console.log(typeof odd, String(typeof odd === "bigint" ? "5n" : JSON.stringify(odd)), at, said);
}
