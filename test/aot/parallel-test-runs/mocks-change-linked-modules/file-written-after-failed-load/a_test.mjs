import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const write = () => writeFileSync(join(import.meta.dir, "deep.mjs"), 'export const n = "as written";\n');
test("t", async () => {
  vi.doMock("./mid.mjs", () => ({ from: "mock", n: 0 }));
  globalThis.stop = true;
  await import("./top.mjs").catch(() => {});
  globalThis.stop = false;
  vi.doUnmock("./mid.mjs");
  write();
  const { read } = await import("./late.mjs");
  console.log("SAID", read(), process.argv.length > 9 ? 1 : 0);
});
