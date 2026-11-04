// It resets the modules: a file that is imported again runs again. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const act = () => async () => {
  await import("./counted.js");
  vi.resetModules();
  await import("./counted.js");
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
