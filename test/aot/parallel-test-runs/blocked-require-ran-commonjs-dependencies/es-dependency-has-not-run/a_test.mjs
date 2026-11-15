import { test, vi } from "bun:test";

const asked = load => {
  try {
    return String(load().seen);
  } catch (error) {
    return "threw " + (/^the body/.test(error.message) ? error.message : error.name);
  }
};

test("a require gives up on a factory that never settles", () => {
  vi.doMock("./valve.mjs", () => new Promise(() => {}));
  console.log("SAID under the mock " + asked(() => require("./pump.mjs")));
});
