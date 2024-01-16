import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const path = join(import.meta.dir, "..", "package.json");
const version = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*(bun-)?v/, "");
const { name, version: oldVersion, ...packageJson } = JSON.parse(readFileSync(path, "utf-8"));

writeFileSync(
  path,
  JSON.stringify(
    {
      name,
      version,
      ...packageJson,
    },
    null,
    2,
  ),
);
