// A getter that runs while the values are listed deletes a key that has not been read yet.
type Point = { x: number; y: number };
function list(p: Point) {
  return Object.values(p).join() + "|" + Object.entries(p).length;
}
function deed(): Point {
  const p: any = {
    get x() {
      delete p.y;
      return 1;
    },
    y: 2,
  };
  return p;
}
console.log(list({ x: 1, y: 2 }));
let all = "";
for (let i = 0; i < 20; i++) all += list({ x: i, y: 1 }) + " ";
console.log(all);
console.log(list(deed()), list({ x: 3, y: 4 }));
