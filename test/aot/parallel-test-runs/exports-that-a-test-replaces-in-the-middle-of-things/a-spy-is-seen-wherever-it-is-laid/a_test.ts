// An export that a spy may replace is expected to hold what the program laid there, and a call of it is made directly behind a test of the callee.
// Wherever the spy is laid (in front of a call, between two calls of one function, while an argument is evaluated, in the middle of a loop) and taken back, the next read sees it.
import { test, spyOn } from "bun:test";
import * as library from "./library";
import { outside, outsideBetween, outsideInTurns, between, inFrontOfItsArguments, inTurns } from "./user";
const lay = (answer: number) => spyOn(library, "add").mockImplementation(() => answer);
test("a spy on an exported function", () => {
  console.log("SEEN as laid", outside(3), between(() => {}, 1), outsideBetween(() => {}, 1), inTurns(10, -1, () => {}), outsideInTurns(10, -1, () => {}));
  let spy = lay(100);
  console.log("SEEN behind a spy", outside(3), between(() => {}, 1), outsideBetween(() => {}, 1), inTurns(10, -1, () => {}), spy.mock.calls.length);
  spy.mockRestore();
  console.log("SEEN taken back", outside(3), between(() => {}, 1), outsideBetween(() => {}, 1));
  console.log("SEEN between two calls", between(() => { spy = lay(7); }, 1)); spy.mockRestore();
  console.log("SEEN between two calls, outside", outsideBetween(() => { spy = lay(7); }, 1)); spy.mockRestore();
  console.log("SEEN while an argument is evaluated", inFrontOfItsArguments(() => { spy = lay(50); return 1; }), inFrontOfItsArguments(() => 1)); spy.mockRestore();
  console.log("SEEN in the middle of a loop", inTurns(10, 5, () => { spy = lay(1000); }), spy.mock.calls.length); spy.mockRestore();
  console.log("SEEN in the middle of a loop, outside", outsideInTurns(10, 5, () => { spy = lay(1000); }), spy.mock.calls.length); spy.mockRestore();
  console.log("SEEN taken back in the middle of a loop", (spy = lay(1000), inTurns(10, 5, () => { spy.mockRestore(); })));
  const arrow = spyOn(library, "twice").mockImplementation(n => -n);
  console.log("SEEN a spy on an arrow", outside(3), inTurns(4, -1, () => {})); arrow.mockRestore();
  const through = spyOn(library, "add");
  console.log("SEEN a spy that calls through", outside(3), through.mock.calls.length, JSON.stringify(through.mock.calls[0])); through.mockRestore();
  console.log("SEEN at the end", outside(3), inTurns(10, -1, () => {}));
});
