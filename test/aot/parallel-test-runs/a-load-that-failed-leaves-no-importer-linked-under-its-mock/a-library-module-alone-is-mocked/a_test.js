import { test, vi } from "bun:test";
test("it", async () => {
  const said = [];
  vi.doMock("node:querystring", () => ({ escape: 5 }));
  const user = await import("./user.mjs");
  vi.doUnmock("node:querystring");
  said.push(typeof user.look() === "function" ? "real" : user.look());
  vi.doMock("node:querystring", () => ({ escape: 6 }));
  said.push(await import("./fails.mjs").then(() => "loaded", error => error.message), globalThis.seen);
  vi.doUnmock("node:querystring");
  said.push(typeof user.look() === "function" ? "real" : user.look());
  for (const a of [7, 8, 9]) {
    vi.doMock("node:querystring", () => ({ escape: a }));
    await import("./other.mjs");
    vi.doUnmock("node:querystring");
    said.push(typeof user.look() === "function" ? "real" : user.look());
  }
  console.log("SAID", said.join(" | "));
});
