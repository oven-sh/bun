import { mock, test } from "bun:test";
mock.module("made-up-pkg", async () => ({ ...(await import("made-up-pkg")), extra: "a" }));
test("a", async () => {
  const dep = await import("made-up-pkg");
  console.log("| a " + dep.kind + " " + dep.extra);
});
