// The object is taken apart by a pattern. The name of the test runner stands in a file that is no test file, and no file imports the runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";
import { act } from "./helper.js";

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
