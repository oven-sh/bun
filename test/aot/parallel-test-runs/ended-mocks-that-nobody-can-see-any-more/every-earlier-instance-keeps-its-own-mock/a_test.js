import { test, vi } from "bun:test";
test("n7", async () => {
  const users = [];
  for (const a of [5, 6, 7, 8]) {
    vi.resetModules();
    vi.doMock("./part.mjs", () => ({ a }));
    users.push(await import("./user.mjs"));
    vi.doUnmock("./part.mjs");
    console.log("SAID n7", users.map(user => user.look()).join());
  }
  console.log("SAID n7 at the end", (await import("./part.mjs")).a, users.map(user => user.look()).join());
});
