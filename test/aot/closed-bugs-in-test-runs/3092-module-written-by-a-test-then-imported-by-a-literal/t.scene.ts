import { test } from "bun:test";
import { writeFileSync, rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const tryIt = async (label: string, ask: () => unknown) => { try { console.log("SAID", label, await ask()); } catch (error) { console.log("SAID", label, "THROWS", String((error as Error).message).split("'")[0].trim()); } };
test("t", async () => {
  const here = import.meta.dirname;
  writeFileSync(join(here, "beside.mjs"), "export const said = 1;\n");
  await tryIt("beside the test file, import():", async () => (await import(join(here, "beside.mjs"))).said);
  writeFileSync(join(here, "beside.cjs"), "exports.said = 2;\n");
  await tryIt("beside the test file, require():", () => require(join(here, "beside.cjs")).said);
  mkdirSync(join(here, "sub"), { recursive: true });
  writeFileSync(join(here, "sub", "inner.mjs"), "export const said = 3;\n");
  await tryIt("in a folder made at run time:", async () => (await import(join(here, "sub", "inner.mjs"))).said);
  const unknown = [here, "unfolded.mjs"].filter(part => part.length > Number(process.env.NOTHING ?? 0)).join("/");
  writeFileSync(unknown, "export const said = 4;\n");
  await tryIt("a path that the build cannot fold:", async () => (await import(unknown)).said);
  const temp = mkdtempSync(join(tmpdir(), "made-"));
  writeFileSync(join(temp, "far.mjs"), "export const said = 5;\n");
  await tryIt("in a temporary folder:", async () => (await import(join(temp, "far.mjs"))).said);
  writeFileSync(join(here, "literal.mjs"), "export const said = 6;\n");
  // @ts-ignore
  await tryIt("a literal relative specifier:", async () => (await import("./literal.mjs")).said);
  await tryIt("still missing, import():", async () => (await import(join(here, "never.mjs"))).said);
  for (const name of ["beside.mjs", "beside.cjs", "unfolded.mjs", "literal.mjs"]) rmSync(join(here, name), { force: true });
  rmSync(join(here, "sub"), { recursive: true, force: true }); rmSync(temp, { recursive: true, force: true });
});
