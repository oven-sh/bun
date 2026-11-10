// In a_test.js mid.js stayed linked to the file k.js beside a mock. That ends with its test file: here mid.js is loaded anew under another mock, and keeps reading that one once it has ended, as under `bun test`.
import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./k.js", () => ({ x: "second" })); const again = await import("./again.js"); console.log("SAID b under", again.seen());
  vi.doUnmock("./k.js"); console.log("SAID b ended", again.seen());
});
