import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as box from "pkg/box.mjs";
vi.mock("pkg/box.mjs", async original => ({ ...(await original()), name: "mock name" }));
test("files written during the run import the namespace through another file", async () => {
  const folder = join(import.meta.dir, "node_modules", "pkg");
  writeFileSync(join(folder, "middle.mjs"), `export * as box from "./box.mjs";\n`);
  writeFileSync(join(folder, "reader.mjs"), `import { box } from "./middle.mjs";
const one = () => box.label();
let last;
for (let turn = 0; turn < 20_000; turn++) last = one();
export const read = last;
`);
  const found = await import(join(folder, "reader.mjs"));
  console.log(box.name, "|", found.read, "|", found.box?.name);
});
