import { test, vi } from "bun:test";

let calls = 0;

// The factory would add a name and count its calls. Nobody calls it: the tests of the file are done while the call still waits for its text.
test("the test ends at once", () => {
  vi.doMock("./part.mjs", async original => {
    calls++;
    return { ...(await original()), added: 1 };
  });
  import("./part.mjs").then(it => console.log("came", Object.keys(it).join(), "| calls", calls, "|", String(it.total()), "|", String(it.missing)));
  console.log("the test ends", calls, String(globalThis.timesRun));
});
