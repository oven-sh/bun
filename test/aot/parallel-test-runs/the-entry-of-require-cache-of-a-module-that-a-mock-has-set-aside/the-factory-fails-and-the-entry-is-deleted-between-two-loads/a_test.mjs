import { test, vi } from "bun:test";
let calls = 0;
test("t", () => {
  const said = [];
  const held = require("./part.mjs");
  vi.doMock("./part.mjs", () => {
    calls++;
    throw new Error("the factory failed");
  });
  const attempt = () => {
    try {
      said.push(require("./part.mjs").a);
    } catch (error) {
      said.push(error.message);
    }
  };
  attempt();
  said.push(delete require.cache[require.resolve("./part.mjs")]);
  attempt();
  vi.doUnmock("./part.mjs");
  console.log(`SAID ${said.join()} ${calls} ${require("./part.mjs") === held} ${globalThis.runsOfPart}`);
});
