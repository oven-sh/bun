// Null, undefined, a text and a number arrive where a layout is written.
type Point = { x: number; y: number };
function list(p: Point) {
  return Object.values(p).join() + "|" + Object.keys(p).join() + "|" + Object.entries(p).join(";");
}
function deed(value: unknown) {
  try {
    return list(value as Point);
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(deed({ x: 1, y: 2 }));
let all = "";
for (let i = 0; i < 20; i++) all += deed({ x: i, y: 1 }) + " ";
console.log(all);
console.log(deed(null), deed(undefined), deed("ab"), deed(5), deed([8, 9]), deed({ x: 3, y: 4 }));
