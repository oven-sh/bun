// makes four small objects that only the next function reads
const operations = 100;
interface Pair {
  left: number;
  right: number;
}
function pair(left: number, right: number): Pair {
  return { left, right };
}
function sum(p: Pair, q: Pair): Pair {
  return { left: p.left + q.left, right: p.right + q.right };
}
function tilted(p: Pair, by: number): Pair {
  return { left: p.left - by, right: p.right * by + 1 };
}
function cross(p: Pair, q: Pair): number {
  return p.left * q.right - p.right * q.left;
}
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += cross(sum(pair(i, 1), tilted(pair(1, i), 0.5)), pair(2, 3));
}

console.log(total);
