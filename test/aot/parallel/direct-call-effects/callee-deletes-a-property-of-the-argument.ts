type Point = { x: number; y?: number };
function makeTools() {
  function drop(point: Point) { delete point.y; }
  function read(point: Point) { return point.x; }
  function run(point: Point) {
    const before = point.y;
    const x = read(point);
    const between = point.y;
    drop(point);
    return before + " " + x + " " + between + " " + point.y + " " + ("y" in point);
  }
  return run;
}
const run = makeTools();
for (let turn = 0; turn < 3; turn++) console.log(run({ x: turn, y: turn + 1 }));
