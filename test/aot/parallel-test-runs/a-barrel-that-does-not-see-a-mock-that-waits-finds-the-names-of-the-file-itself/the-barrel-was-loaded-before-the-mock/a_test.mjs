import { test, vi } from "bun:test";
const tried = async read => { try { return String(await read()); } catch (error) { return "threw " + error.name; } };
import "./user.mjs";
test("t", async () => {
  vi.doMock("./part.mjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID under", user.look());
  vi.doUnmock("./part.mjs");
  console.log("SAID at once", user.look());
  const next = await import("./part.mjs");
  console.log("SAID behind a load", user.look(), "|", Object.keys(next).join(), next.left);
  console.log("SAID once more", user.look(), globalThis.ran);
});
