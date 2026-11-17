import { test, vi } from "bun:test";
import * as page from "../src/page.mjs";
import * as first from "../src/svc.mjs";

test("a", async () => {
  console.log("SAID", page.show(), first.load());
  vi.doMock("../src/api.mjs", () => ({ get: () => "test", other: () => "none" }));
  const again = await import("../src/page.mjs");
  console.log("SAID", again.show(), again === page, (await import("../src/svc.mjs")) === first);
  vi.doUnmock("../src/api.mjs");
  const last = await import("../src/page.mjs");
  console.log("SAID", last.show(), last === again, last === page, globalThis.runs);
});
