import { join } from "node:path";

import pkg from "../package.json";

const BUN_VERSION = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*v/, "");

await Bun.write(join(import.meta.dir, "../package.json"), JSON.stringify({ ...pkg, version: BUN_VERSION }, null, 2));

// copy CLAUDE.md
let claude = Bun.file(join(import.meta.dir, "../../../src/init/rule.md"));
if (await claude.exists()) {
  let original = await claude.text();
  const endOfFrontMatter = original.lastIndexOf("---\n");
  original = original.replaceAll("node_modules/bun-types/", "");
  if (endOfFrontMatter > -1) {
    original = original.slice(endOfFrontMatter + "---\n".length).trim() + "\n";
  }

  await Bun.write(join(import.meta.dir, "../CLAUDE.md"), original);
}

// Copy docs
const docsDir = join(import.meta.dir, "../docs");
const sourceDocsDir = join(import.meta.dir, "../../../docs");
await Bun.$`rm -rf ${docsDir}`;

const sourceDocFiles = new Bun.Glob("**/*.{md,mdx}").scanSync({ cwd: sourceDocsDir });
for (const file of sourceDocFiles) {
  const content = await Bun.file(join(sourceDocsDir, file)).text();

  const updatedContent = content
    .replace(/\$BUN_LATEST_VERSION/g, BUN_VERSION)
    // Prefix copied doc paths with /docs/ (handles both links and images)
    .replace(
      /(!?\[([^\]]*)\])\(\/(runtime|pm|test|bundler|project|guides|installation|quickstart|typescript|feedback|index)(\/[^)]*)?\)/g,
      "$1(/docs/$3$4)",
    )
    // Convert non-copied content to absolute URLs (images, blog, etc.)
    .replace(/(!?\[([^\]]*)\])\(\/(images|blog)(\/[^)]*)?\)/g, "$1(https://bun.com/$3$4)")
    .replace(/https:\/\/bun\.com\/docs\/guides\//g, "https://bun.com/guides/");

  await Bun.write(join(docsDir, file), updatedContent);
}
