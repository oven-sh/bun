// Lists that die where they are read serve the next literal. Those that somebody keeps stay as they are.
const kept = [], closures = [];
function around(x, y, n) {
  const found = [];
  if (x > 0) found.push({ x: x - 1, y });
  if (x < n - 1) found.push({ x: x + 1, y });
  if (y > 0) found.push({ x, y: y - 1 });
  if (y < n - 1) found.push({ x, y: y + 1 });
  return found;
}
function numbers(n, fraction) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i + fraction);
  return list;
}
function total(n) {
  let t = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const near = around(x, y, n);
      for (let k = 0; k < near.length; k++) t += near[k].x * 10 + near[k].y;
      if (x === 2 && y === 1) kept.push(near);
      if (x === 3 && y === 3) closures.push(() => near.length + near[0].x);
      const whole = numbers(x + y, 0), halves = numbers(x, 0.5);
      for (const v of whole) t += v;
      for (let k = 0; k < halves.length; k++) t += halves[k] * 2;
      if (x === 0 && y === 4) kept.push(whole);
    }
  }
  return t;
}
function largest(values, from) {
  const some = [];
  for (let i = from; i < from + 6 && i < values.length; i++) if (values[i] > 3) some.push(values[i]);
  let best = -1;
  for (let k = 0; k < some.length; k++) if (some[k] > best) best = some[k];
  return best;
}
const values = [3, 9, 1, 4.5, 7, 2, 8, -0, 5, 6.25, 11, 0];
let sum = 0;
for (let turn = 0; turn < 30; turn++) {
  sum += total(5);
  for (let from = 0; from < values.length; from++) sum += largest(values, from);
  if (turn % 10 === 3) Bun.gc(true);
}
console.log(sum, kept.length, kept[0].map(k => k.x + ":" + k.y).join(), kept[1].join(), kept[kept.length - 2].map(k => k.x + ":" + k.y).join(), closures.map(f => f()).join());
// A list that comes back on one way alone, and a throw in its middle.
function chosen(n, deep) {
  const list = [];
  for (let i = 0; i < n; i++) { if (i === 5) throw list; list.push(i * 3); }
  return deep ? chosen(n - 1, false) : list;
}
let lines = "";
for (let n = 0; n < 8; n++) {
  for (const deep of [false, true]) {
    try { const list = chosen(n, deep); let t = 0; for (let k = 0; k < list.length; k++) t += list[k]; lines += t + ","; } catch (list) { lines += "!" + list.join("-") + ","; kept.push(list); }
  }
}
console.log(lines, kept.slice(-2).join("|"));
