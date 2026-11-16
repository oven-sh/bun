// A member is read under a name that is made when the file runs. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const name = ["spy", "On"].join("");
const act = lib => {
  const spy = vi[name](lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
