// Whose link decides. early.js is linked first, and with it barrel.js, inner.js and lib.js. Then `vi.doMock()` names lib.js, which leaves what is linked alone. late.js is linked behind the mock
// and imports from the SAME barrel: inner.js was linked to the file itself, so late.js reads the file itself. Not the link of the reader decides, but that of the file that names lib.js.
// fresh.js is linked behind the mock too and imports from lib.js: it reads the mock, so the mock does stand.
// Plain should print real fn . real fn . real fn . mock fn . "real fn,real fn,mock fn".
import { test, vi } from "bun:test";
import { read } from "./early.js";

test("a reader linked behind the mock reads through a barrel that was linked before it", async () => {
  console.log("| early, before", read());
  vi.doMock("./lib.js", () => ({ fn: () => "mock fn" }));
  console.log("| early, mocked", read());
  const late = await import("./late.js");
  console.log("| late", late.read());
  const fresh = await import("./fresh.js");
  console.log("| fresh", fresh.read());
  let seen = "";
  for (let i = 0; i < 300; i++) seen = [read(), late.read(), fresh.read()].join();
  console.log("| in a loop", seen);
});
