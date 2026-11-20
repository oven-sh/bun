import { test, mock } from "bun:test";

test("a", async () => {
  const one1 = await import("./one.mjs").catch(error => error);
  await mock.module("./mid.mjs", () => ({ mid: "mock" }));
  const one2 = await import("./one.mjs").catch(error => error);
  console.log("SAID 1 " + one1.name + " " + (one1 === one2) + " " + (one2 instanceof Error ? one2.name : typeof one2.one));
  console.log("SAID zz end");
});
