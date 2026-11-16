import { test, mock } from "bun:test";
test("every name of the ring", async () => {
  if (JSON.parse("false")) mock.module("./m2.mjs", () => ({ x2: 20 }));
  const all = await import("./index.mjs");
  console.log(
    "SAID",
    Object.keys(all)
      .sort()
      .map(name => name + "=" + all[name])
      .join(),
  );
});
