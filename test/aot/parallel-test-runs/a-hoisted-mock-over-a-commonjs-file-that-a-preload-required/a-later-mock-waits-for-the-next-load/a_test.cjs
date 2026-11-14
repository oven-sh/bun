const { test, vi, mock } = require("bun:test");
vi.mock("./part.cjs");
test("t", () => {
  try {
    mock.module("./part.cjs", () => {
      console.log("SAID the later factory is called");
      throw new RangeError("made up");
    });
    console.log("SAID the call returns");
  } catch (error) {
    console.log("SAID the call throws", error.name);
  }
  try {
    console.log("SAID required", require("./part.cjs").a);
  } catch (error) {
    console.log("SAID require throws", error.name);
  }
});
