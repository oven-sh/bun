// The loop itself deletes the name that is still to come, off a record of a written type: no call stands between the delete and the next step.
type Point = { x: number; y?: number; z?: number };
function walk(point: Point, drops: boolean) {
  let text = "";
  for (const k in point) {
    text += k + "=" + (point as any)[k] + " ";
    if (drops && k === "x") delete point.y;
  }
  return text + "| " + Object.keys(point).join();
}
function deed() { return walk({ x: 1, y: 2, z: 3 }, true); }
console.log(deed());
for (let round = 0; round < 4; round++) console.log(walk({ x: round, y: 2, z: 3 }, false), "#", deed());
