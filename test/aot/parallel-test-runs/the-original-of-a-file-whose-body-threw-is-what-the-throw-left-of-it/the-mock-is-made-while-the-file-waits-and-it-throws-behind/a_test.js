// case: v5 the mock is laid while the file still runs, and it throws behind
const far = process.argv.length > 99 ? "y" : "";
import { test, mock, jest } from "bun:test";

test("v5", async () => {
  let open;
  globalThis.gate = new Promise(resolve => { open = resolve; });
  const loading = import("./lib.mjs").then(() => "loaded", error => error.message);
  await null;
  mock.module("./lib.mjs", () => ({ mocked: 1 }));
  open();
  const first = await loading;
  for (let turn = 0; turn < 2; ++turn) {
    let said = "none";
    let early = "-";
    try {
      early = String(jest.requireActual("./lib.mjs").early);
    } catch (error) {
      said = error.constructor.name;
    }
    console.log("SAID v5 " + [first, said, early].join(" ") + far);
  }
});
