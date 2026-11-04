// The built-in is called under another name, and a local that is named Object is called in its place.
type Point = { x: number; y: number };
const listOf = Object.values;
function renamed(p: Point) {
  return listOf(p).join();
}
function deed(p: Point) {
  const Object = {
    values(q: Point) {
      return ["local", q.y];
    },
    keys(q: Point) {
      return ["none", q.x];
    },
  };
  return Object.values(p).join() + "|" + Object.keys(p).join();
}
console.log(renamed({ x: 1, y: 2 }), deed({ x: 1, y: 2 }));
let all = "";
for (let i = 0; i < 20; i++) all += renamed({ x: i, y: 1 }) + " " + deed({ x: i, y: 1 }) + " ";
console.log(all);
