class Keeper { rows = [2, 7, 0, 3, 2, 7]; first = 3; read(i) { return this.rows[i]; } either(i) { if (i === 4) return this.first; return this.rows[i]; } both(i, k) { return k ? this.rows[i] : this.rows[i + 2]; } }
const keeper = new Keeper();
function sums(n) { let total = 0; for (let turn = 0; turn < 2; turn++) for (let i = 0; i < n; i++) { total += keeper.either(i); } return total; }
function products(n) { let total = 1; for (let turn = 0; turn < 2; turn++) for (let i = 0; i < n; i++) { total = (total * keeper.read(i)) / 3 - keeper.both(i, i & 1); } return total; }
function masks(n) { let total = 0; for (let i = 0; i < n; i++) { total = (total ^ keeper.read(i)) + ~keeper.either(i); } return total; }
function kinds(n) { let text = ""; for (let i = 0; i < n; i++) text += typeof keeper.read(i) + keeper.either(i); return text; }
const n = Number(process.argv[2] ?? 9);
keeper.rows.fill(1, keeper.rows.length, 9);
for (const count of [2, 5, n]) console.log(sums(count), products(count), masks(count), kinds(count));
