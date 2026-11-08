// What a test lays may pass the test for the function that the program laid: the file's own function handed back by a mock, or ANOTHER CLOSURE OF THE SAME FUNCTION.
// The function is then entered directly, and what it captured must be read off the value that arrived, not off what the variable held.
import { test, mock, spyOn } from "bun:test";
import { once, inTurns, between } from "./user";
import * as library from "./library";
import { makeCounter, makeNamer } from "./maker";
const own = { add: library.add, counter: library.counter, namer: library.namer, counted: library.counted };
test("another closure of the same function", () => {
  console.log("SEEN as laid", once(1), inTurns(10), between(() => {}));
  mock.module("./library", () => ({ add: own.add, counter: makeCounter(1000), namer: makeNamer("of the mock"), counted: own.counted }));
  console.log("SEEN behind a mock that hands back functions of the file", once(1), inTurns(10), between(() => {}));
  console.log("SEEN a mock laid between two calls", between(() => { mock.module("./library", () => ({ add: own.add, counter: makeCounter(500000), namer: makeNamer("of the second mock"), counted: own.counted })); }));
  mock.module("./library", () => own);
  console.log("SEEN the file's own closures again", once(1), inTurns(10), between(() => {}));
});
test("a spy that calls through", () => {
  const spy = spyOn(library, "counter");
  console.log("SEEN through a spy", once(1), inTurns(10), spy.mock.calls.length);
  spy.mockImplementation(makeCounter(7000));
  console.log("SEEN another closure under the spy", once(1), inTurns(10), spy.mock.calls.length);
  spy.mockRestore();
  console.log("SEEN restored", once(1), inTurns(10), between(() => {}));
});
