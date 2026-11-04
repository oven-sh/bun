// An object of a written type that got one more name lists that one too.
type Point = { x: number; y: number };
function list(p: Point) {
  return Object.values(p).join() + "|" + Object.entries(p).join(";") + "|" + Object.keys(p).join();
}
function deed(p: Point) {
  (p as any).z = "more";
  return p;
}
const point: Point = { x: 1, y: 2 };
console.log(list(point));
let all = "";
for (let i = 0; i < 20; i++) all += list({ x: i, y: 0 }) + " ";
console.log(all);
console.log(list(deed(point)), list(deed({ x: 5, y: 6 })), list({ x: 7, y: 8 }));
