// It replaces a global object. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const act = () => {
  vi.stubGlobal("Math", { max: () => 7 });
  console.log("Math.max", Math.max(1, 2));
  return () => vi.unstubAllGlobals();
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
