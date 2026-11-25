import { test, vi, mock } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
test("t", async () => {
  const folder = join(import.meta.dir, "written");
  mkdirSync(folder, { recursive: true });
  const from = JSON.stringify("../all.mjs");
  for (const name of ["reader.mjs", "second.mjs"]) writeFileSync(join(folder, name), "import { kept } from " + from + "; export const read = () => kept; export const late = () => kept;");
  const say = read => { try { return String(read()); } catch (error) { return error.name + ": " + error.message; } };
  const said = [];
  vi.doMock("./sizes.cjs", () => ({ kept: "mocked", inner: "mocked" }));
  const reader = await import(join(folder, "reader.mjs"));
  said.push(say(reader.read));
  vi.doMock("./sizes.cjs", () => ({ kept: "second", inner: "second" }));
  said.push(say(reader.read));
  said.push(say(reader.late));

  if (process.argv.length > 99) await import("./all.mjs");
  console.log("SAID", said.join(), globalThis.ran ?? 0);
});
