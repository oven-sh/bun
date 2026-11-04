// The loop deletes the name off the object it lists, under another name for it.
type Point = { x: number; y?: number; z?: number };
function walk(point: Point, same: Point, drops: boolean) {
  let text = "";
  for (const k in point) {
    text += k + " ";
    if (drops && k === "x") Reflect.deleteProperty(same, "y");
  }
  return text + "| " + Object.keys(point).join();
}
function deed() { const p = { x: 1, y: 2, z: 3 }; return walk(p, p, true); }
console.log(deed());
for (let round = 0; round < 4; round++) console.log(walk({ x: round, y: 2, z: 3 }, { x: 0 }, true), "#", deed());
