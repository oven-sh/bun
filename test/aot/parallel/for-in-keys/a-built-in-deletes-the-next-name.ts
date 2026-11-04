// A built-in takes away the name that is still to come: its row runs no code of anybody on a record.
type Point = { x: number; y?: number; z?: number };
function walk(point: Point, drops: boolean) {
  let text = "";
  for (const k in point) {
    text += k + " ";
    if (drops && k === "x") Reflect.deleteProperty(point, "y");
  }
  return text + "| " + Object.keys(point).join();
}
function deed() { return walk({ x: 1, y: 2, z: 3 }, true); }
console.log(deed());
for (let round = 0; round < 4; round++) console.log(walk({ x: round, y: 2, z: 3 }, false), "#", deed());
