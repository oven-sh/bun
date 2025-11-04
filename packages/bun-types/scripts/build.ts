import { join } from "node:path";

import pkg from "../package.json";

const BUN_VERSION = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*v/, "");

let claude = Bun.file(join(import.meta.dir, "..", "CLAUDE.md"));
if (await claude.exists()) {
  let original = await claude.text();
  const endOfFrontMatter = original.lastIndexOf("---\n");
  original = original.replaceAll("node_modules/bun-types/", "");
  if (endOfFrontMatter > -1) {
    original = original.slice(endOfFrontMatter + "---\n".length).trim() + "\n";
  }

  await claude.write(original);
}

await Bun.write(join(import.meta.dir, "..", "package.json"), JSON.stringify({ version: BUN_VERSION, ...pkg }, null, 2));
