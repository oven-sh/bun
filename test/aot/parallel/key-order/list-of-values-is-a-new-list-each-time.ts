// Each list of values, and each pair of entries, is a new list that the program writes into.
type Point = { x: number; y: number };
function values(p: Point) {
  return Object.values(p);
}
function entries(p: Point) {
  return Object.entries(p);
}
function deed(p: Point) {
  const first = values(p);
  const second = values(p);
  first[0] = 99;
  first.push(7);
  const pairs = entries(p);
  const again = entries(p);
  pairs[0][1] = 55;
  pairs.length = 1;
  return [first === second, first.join(), second.join(), pairs.join(";"), again.join(";"), pairs[0] === again[0], p.x, p.y].join(" ");
}
console.log(deed({ x: 1, y: 2 }));
let all = "";
for (let i = 0; i < 20; i++) all += deed({ x: i, y: 2 }) + "\n";
console.log(all);
