import { test } from "bun:test";
import { statSync, utimesSync, writeFileSync } from "node:fs";
test("import() under a type of code finds the CommonJS module that has run", async () => {
  const file = import.meta.dir + "/a.cjs";
  const when = statSync(file).mtimeMs / 1000;
  console.log((await import("./a.cjs")).default.text, globalThis.ran);
  writeFileSync(file, 'globalThis.ran = (globalThis.ran ?? 0) + 1;\nexports.text = "a new text";\n');
  utimesSync(file, when + 20, when + 20);
  const kind = globalThis.never ?? "js";
  console.log((await import("./a.cjs", { with: { type: kind } })).default.text, globalThis.ran);
  console.log((await import("./a.cjs", { with: { type: "js" } })).default.text, globalThis.ran);
});
