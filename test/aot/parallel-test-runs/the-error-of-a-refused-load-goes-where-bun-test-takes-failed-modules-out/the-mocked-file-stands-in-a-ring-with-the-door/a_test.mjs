import { test, mock } from "bun:test";

test("the mocked file stands ahead of the failing one in a ring with the door", async () => {
  const one1 = await import("./one.mjs").catch(error => error);
  await mock.module("./mid.mjs", () => ({ mid: "mock", back: () => "mock" }));
  const one2 = await import("./one.mjs").catch(error => error);
  console.log("SAID " + [one1.name, one1 === one2].join(","));
});
