import { test, vi } from "bun:test";
test("the import waits for a plugin while two later mocks are laid", async () => {
  const asked = Promise.withResolvers();
  const gate = Promise.withResolvers();
  Bun.plugin({
    name: "slow",
    setup(build) {
      build.onLoad({ filter: /slow\.mjs$/ }, async () => {
        asked.resolve();
        await gate.promise;
        return { contents: 'export const s = "slow";', loader: "js" };
      });
    },
  });
  vi.doMock("./mocked.mjs", () => {
    console.log("first factory runs");
    return { x: "first" };
  });
  const user = import("./user.mjs");
  await asked.promise;
  vi.doMock("./mocked.mjs", () => {
    console.log("second factory runs");
    return { x: "second" };
  });
  vi.doMock("./mocked.mjs", () => {
    console.log("third factory runs");
    return { x: "third" };
  });
  gate.resolve();
  console.log((await user).seen);
});
