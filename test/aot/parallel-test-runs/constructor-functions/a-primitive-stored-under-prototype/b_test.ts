import { test } from "bun:test";

interface Counted {
  n: number;
}
function Dial(this: Counted) {
  this.n = 3;
}
function countNulls(p: object | null): number {
  let hits = 0;
  for (let i = 0; i < 300; i++) if (p === null) hits++;
  return hits;
}

test("the same where the types are written", () => {
  (Dial as any).prototype = null;
  console.log("stored:", countNulls(Dial.prototype));
});
