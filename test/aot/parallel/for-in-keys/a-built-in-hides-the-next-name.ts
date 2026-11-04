// A built-in makes the name that is still to come one that no for-in lists.
type Point = { x: number; y?: number; z?: number };
function walk(point: Point, hides: boolean) {
  let text = "";
  for (const k in point) {
    text += k + " ";
    if (hides && k === "x") Object.defineProperty(point, "y", { enumerable: false });
  }
  return text + "| " + Object.keys(point).join();
}
function deed() { return walk({ x: 1, y: 2, z: 3 }, true); }
console.log(deed());
for (let round = 0; round < 4; round++) console.log(walk({ x: round, y: 2, z: 3 }, false), "#", deed());
