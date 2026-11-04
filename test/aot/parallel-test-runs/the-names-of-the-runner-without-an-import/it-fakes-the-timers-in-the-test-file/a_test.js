// It fakes the timers. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const act = () => {
  vi.useFakeTimers();
  let hit = 0;
  setTimeout(() => hit++, 1000);
  vi.advanceTimersByTime(5000);
  console.log("hit", hit);
  return () => vi.useRealTimers();
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
