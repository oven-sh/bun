import { test, vi } from "bun:test";

const asked = load => {
  try {
    return String(load().seen);
  } catch (error) {
    return "threw " + (/^the body/.test(error.message) ? error.message : error.name);
  }
};

test("the next test file asks again", () => {
  console.log("SAID without it " + asked(() => require("./pump.mjs")));
});
