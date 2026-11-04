// It mocks a module that is loaded behind the call. The name of the test runner stands in the test file, which imports no runner.
import * as lib from "./lib.js";
import { read } from "./reader.js";

const act = () => {
  vi.doMock("./late.js", () => ({ late: "mock" }));
  return async () => console.log("late", (await import("./late.js")).late);
};

test("what the reader gets", async () => {
  const undo = act(lib);
  console.log("under it", read());
  if (undo) await undo();
  console.log("behind it", read());
});
