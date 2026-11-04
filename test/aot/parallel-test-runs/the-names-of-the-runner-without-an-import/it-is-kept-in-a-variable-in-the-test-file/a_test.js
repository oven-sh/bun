// The object is kept in a variable. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const kept = vi;
const act = lib => {
  const spy = kept.spyOn(lib, "total").mockReturnValue("spied");
  return () => spy.mockRestore();
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
