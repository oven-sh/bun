import { test, vi, mock, jest } from "bun:test";
const seen = it => it.kept ?? it.default?.kept;
test("t", async () => {
  vi.doMock("pack/lib.mjs", () => ({ kept: 10 }));
  const first = await import("./user.mjs");
  console.log("SAID first", first.look());
  mock.module("pack/lib.mjs", () => ({ kept: 20 }));
  console.log("SAID the file", seen(await import("pack/lib.mjs")), first.look());
  const next = await import("./next.mjs");
  console.log("SAID late", first.look(), next.look(), globalThis.ran ?? 0);
  const again = await import("./user.mjs");
  console.log("SAID again", again === first, again.look());
});
