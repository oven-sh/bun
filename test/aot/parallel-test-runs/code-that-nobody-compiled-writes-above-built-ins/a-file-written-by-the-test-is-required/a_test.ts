// The file does not exist while the run is built.
import { test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { codes, codesWithHook, cut, fixed, found, owns, total, totalOfSet } from "./app";
const named = (...parts: string[]): string => parts.join("");
function all(): string {
  const text = named("ab", "cd"), list = [1, 2, 3].map(value => value + text.length - 4);
  const shown: unknown[] = [];
  for (const ask of [() => codes(text), () => cut(text), () => total(list), () => totalOfSet(new Set(list)), () => found(new Map([[text, 5]]), text), () => fixed(list.length / 2), () => owns(list, "0")]) {
    try {
      shown.push(ask());
    } catch (error) {
      shown.push((error as Error).constructor.name);
    }
  }
  return shown.join(" ");
}
test("The file does not exist while the run is built.", () => {
  if (process.env.NEVER) Bun.plugin({ name: "never", setup() {} });
  console.log(all());
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "laid-")), named("lay", ".cjs"));
  fs.writeFileSync(file, named("String.prototype.charCodeAt = function () { return 4; ", "}; Map.prototype.get = function () { return \"laid\"; };"));
  require(file);
  console.log(all());
});
