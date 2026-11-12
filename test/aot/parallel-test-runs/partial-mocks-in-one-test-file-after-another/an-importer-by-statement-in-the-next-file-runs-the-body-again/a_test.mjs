import { mock, test, vi } from "bun:test";
const say = async label => {
  const dep = await import("./dep.mjs");
  console.log("| " + label + " " + dep.kind + " " + dep.extra + " " + dep.run);
};
const partly = extra => async () => ({ ...(await import("./dep.mjs")), extra });
test("a", async () => {
  mock.module("./dep.mjs", partly("a"));
  await say("a");
});
