// `Object.defineProperty(object, key, { .. })`: what the literal says is read by one text. Whoever spells the name of a flag
// of a descriptor anywhere else has begun a second one.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function filesThatSpell(folder: string, files: string, spelling: RegExp, isLeftOut: (name: string) => boolean) {
  const names = [...new Bun.Glob(files).scanSync(folder)].map(name => name.replaceAll("\\", "/")).sort();
  return names.filter(name => !isLeftOut(name) && spelling.test(readFileSync(join(folder, name), "utf8")));
}

test("the front end", () => {
  const folder = join(import.meta.dir, "..", "..", "src", "aot");
  const spelling = /\b(?:b"|known::)(?:writable|enumerable|configurable)\b/;
  const isTest = (name: string) => /(?:^|\/)tests(?:\/|\.rs$)/.test(name);
  expect(filesThatSpell(folder, "**/*.rs", spelling, isTest)).toEqual(["modules/written_descriptor.rs"]);
});
