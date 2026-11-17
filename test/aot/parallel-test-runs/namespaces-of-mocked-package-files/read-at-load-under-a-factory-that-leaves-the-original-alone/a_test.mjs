import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as box from "pkg/box.mjs";
vi.mock("pkg/box.mjs", () => ({ name: "mock name", label: () => "mock label", count: 9, add() {} }));
test("files written during the run import the namespace through another file", async () => {
  const folder = join(import.meta.dir, "node_modules", "pkg");
  writeFileSync(join(folder, "middle.mjs"), `export * as box from "./box.mjs";\n`);
  writeFileSync(join(folder, "reader.mjs"), `import { box } from "./middle.mjs";
export const read = box.name;
`);
  const found = await import(join(folder, "reader.mjs"));
  console.log(box.name, "|", found.read, "|", found.box?.name);
});
