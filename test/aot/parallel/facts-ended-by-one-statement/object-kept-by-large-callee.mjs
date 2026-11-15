let last = null;
const all = [];
function look(point, depth) {
  if (depth > 0) return look(point, depth - 1) + 1;
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += point.x * i + point.y;
  for (let i = 0; i < 3; i++) sum = (sum * 7 + i) | 0;
  if (point.x === 3) last = point;
  if (point.x === 4) all.push(point);
  return sum;
}
function run(n) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const point = { x: i, y: i * 2 };
    total += look(point, 1);
    point.x += 10;
    point.y = -i;
    total += point.x;
  }
  return total;
}
console.log(run(6), JSON.stringify(last), JSON.stringify(all));
last.y = "kept";
all[0].z = 1;
console.log(run(3), JSON.stringify(last), JSON.stringify(all));
