class Box { constructor(k) { this.k = k | 0; } }
const arg = process.argv.length > 2 ? process.argv.slice(2) : ["0", "1"], has = arg[0] === "1", p = arg[1] === "1", x = Number(arg[2] ?? 5) | 0, y = Number(arg[3] ?? 6) | 0;
const one = new Box(has ? 3 : 0), two = new Box(7);
async function pick(a, b, x, y, p) {
  await 0;
  if (x === 0 || y === 0 || b.k <= 0) return -2;
  const c = p && a.k > 0;
  const v = c ? a : b, w = c ? x : y;
  if (w !== 0 && v.k > 0) return v.k;
  return -3;
}
console.log(await pick(one, two, x, y, p));
