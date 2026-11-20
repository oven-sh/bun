import { test, vi } from "bun:test";
const log = (globalThis.log = []);
test("a", () => {
  vi.doMock("./wick.mjs", () => {
    log.push("f<");
    const got = require("./oil.mjs").oil;
    log.push("f-");
    return { width: "mock " + got };
  });
  console.log(require("./post.mjs").post(), "|", log.join(" "));
});
