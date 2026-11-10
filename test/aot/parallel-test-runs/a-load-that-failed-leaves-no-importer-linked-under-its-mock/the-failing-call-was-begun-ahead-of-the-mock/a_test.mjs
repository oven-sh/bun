import { test, vi } from "bun:test";
const fails = async ask => {
  try {
    await ask();
    return "came";
  } catch (error) {
    return error.constructor.name;
  }
};
const read = user => {
  try {
    return user.read();
  } catch (error) {
    return error.constructor.name;
  }
};
test("a", async () => {
  const said = [];
  const begun = fails(() => import("./top.mjs"));
  vi.doMock("./dep.mjs", () => ({ who: "mock" }));
  const user = require("./user.mjs");
  said.push(read(user), user.step());
  vi.doUnmock("./dep.mjs");
  said.push(await begun, read(user), read(user));
  said.push(user.step(), user.step(), typeof user.read, read(user), read(user), "|", globalThis.ran);
  console.log("SAID", ...said);
});
