// The values of an object of a written type are listed in the order in which that object got its keys.
type Point = { x: number; y: number };
function list(p: Point) {
  return Object.values(p).join();
}
function deed(): Point {
  return JSON.parse('{"y":2,"x":1}');
}
function swapped(): Point {
  const p: any = { x: 1, y: 2 };
  delete p.x;
  p.x = 9;
  return p;
}
console.log(list({ x: 1, y: 2 }), list(deed()), list(swapped()));
let all = "";
for (let i = 0; i < 40; i++) all += list({ x: i, y: -i }) + ";";
console.log(all);
console.log(list(deed()), list(swapped()), list({ x: 3, y: 4 }));
