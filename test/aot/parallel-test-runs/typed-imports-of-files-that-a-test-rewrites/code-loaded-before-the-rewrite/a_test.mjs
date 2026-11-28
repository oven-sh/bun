import { test } from "bun:test";
import { statSync, utimesSync, writeFileSync } from "node:fs";
test("import() under a type of code answers with the module that it has loaded", async () => {
  const file = import.meta.dir + "/a.ts";
  const when = statSync(file).mtimeMs / 1000;
  const kind = globalThis.never ?? "ts";
  console.log((await import("./a.ts", { with: { type: kind } })).default, globalThis.ran);
  writeFileSync(file, 'globalThis.ran = (globalThis.ran ?? 0) + 1;\nexport default "a new text";\n');
  utimesSync(file, when + 20, when + 20);
  console.log((await import("./a.ts", { with: { type: kind } })).default, globalThis.ran);
  console.log((await import("./a.ts", { with: { type: kind } })).default, globalThis.ran);
});
