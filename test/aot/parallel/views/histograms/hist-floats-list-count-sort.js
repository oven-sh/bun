function walk(data, count, from, drop) {
  let total = 0;
  const table = new Array(16).fill(0), out = new Uint16Array(24);
  for (let i = 0; i < count; i++) { out[table[data[i]]++] = data[i]; }
  return [total, Array.from(table).join(), Array.from(out).join(), Object.keys(table).length].join(" / ");
}
for (const count of [0, 3, 9, 14, 5.5, -1]) for (const from of [0, 2, -1]) {
  let said;
  try { said = walk(new Float64Array([3, 0.5, NaN, -0, 1e300, 2]), count, from, count === 9); } catch (e) { said = e.constructor.name; }
  console.log(count, from, said);
}
