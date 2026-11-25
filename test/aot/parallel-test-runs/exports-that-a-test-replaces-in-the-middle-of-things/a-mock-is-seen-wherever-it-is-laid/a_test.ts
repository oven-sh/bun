// The same for mock.module(): each use of an import from a file that may be mocked asks whether a mock is laid; where none is, the call is made directly behind a test of the callee.
import { test, mock } from "bun:test";
import { outside, outsideBetween, outsideInTurns, between, inTurns } from "./user";
const lay = (answer: number) => mock.module("./library", () => ({ add: () => answer, twice: (n: number) => n * 3, Box: class { size = 0; constructor(n: number) { this.size = -n; } grow(by: number) { return this.size - by; } } }));
test("a mock of the file", () => {
  console.log("SEEN as laid", outside(3), between(() => {}, 1), outsideBetween(() => {}, 1), inTurns(10, -1, () => {}), outsideInTurns(10, -1, () => {}));
  console.log("SEEN between two calls, outside", outsideBetween(() => { lay(7); }, 1));
  console.log("SEEN behind the mock", outside(3), outsideBetween(() => {}, 1), outsideInTurns(10, -1, () => {}));
  console.log("SEEN another mock in the middle of a loop", outsideInTurns(10, 5, () => { lay(1000); }));
  console.log("SEEN at the end", outside(3));
});
