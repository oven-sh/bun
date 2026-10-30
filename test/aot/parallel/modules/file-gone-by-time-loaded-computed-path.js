// Looks up the path of a file, removes the file, and then asks for it with require() and import().
const { mkdtempSync, writeFileSync, rmSync, realpathSync } = require("node:fs");
const { join } = require("node:path");
const folder = mkdtempSync(join(realpathSync(require("node:os").tmpdir()), "gone-"));
const withoutFolder = text => String(text).replaceAll(folder, "<folder>").replaceAll("\\", "/");
const describe = error =>
  [error.constructor.name, error.name, withoutFolder(error.message), error.code, Reflect.ownKeys(error).join()].join(" | ");
for (const name of ["late.js", "late.ts", "late.cjs", "late.mjs", "late.tsx", "late.json", "late.txt"]) {
  const path = join(folder, name);
  writeFileSync(path, name.endsWith(".json") ? "{}" : "");
  console.log(name, "resolves", withoutFolder(require.resolve(path)));
  rmSync(path);
  try {
    console.log(name, "require", typeof require(path));
  } catch (error) {
    console.log(name, "require", describe(error));
  }
  await import(path).then(
    loaded => console.log(name, "import", typeof loaded),
    error => console.log(name, "import", describe(error)),
  );
}
rmSync(folder, { recursive: true });
