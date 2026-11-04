// A for-in over a record with two names, whose turns may be written out: a turn deletes the name that is still to come, adds one, makes it an accessor, or freezes the record.
type Point = { x: number; y: number };
function total(point: Point, change: (point: Point, k: string) => void) {
  let text = "";
  for (const k in point) {
    change(point, k);
    text += k + "=" + (point as any)[k] + " ";
  }
  return text + Object.keys(point).join();
}
const nothing = () => {};
function deed() {
  return [
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") delete (point as any).y; }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") (point as any).z = 3; }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") Object.defineProperty(point, "y", { get() { return "got"; }, enumerable: true, configurable: true }); }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") Object.defineProperty(point, "y", { value: 5, enumerable: false }); }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") Object.freeze(point); }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") { delete (point as any).y; point.y = 9; } }),
    total({ x: 1, y: 2 }, (point, k) => { if (k === "x") Object.setPrototypeOf(point, { above: 7 }); }),
  ].join(" | ");
}
console.log(deed());
for (let round = 0; round < 4; round++) console.log(total({ x: round, y: 2 }, nothing), "#", deed());
