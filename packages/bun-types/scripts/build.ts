import { join, resolve } from "node:path";

import pkg from "../package.json";

const BUN_VERSION = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*v/, "");

// Usage: bun scripts/build.ts [outDir]
//
// The generated files (package.json with the version filled in, CLAUDE.md, docs/)
// are written to outDir, by default this package's own directory, which is what the
// release workflow publishes. test/integration/bun-types builds into a scratch copy
// of the package instead so that running the test never modifies the checkout.
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "..");

await Bun.write(join(outDir, "package.json"), JSON.stringify({ ...pkg, version: BUN_VERSION }, null, 2));

// copy CLAUDE.md
let claude = Bun.file(join(import.meta.dir, "../../../src/cli/init/rule.md"));
if (await claude.exists()) {
  let original = await claude.text();
  const endOfFrontMatter = original.lastIndexOf("---\n");
  // The template locates the docs through the project's node_modules, once per install
  // layout (hoisted path, then the isolated store path in parentheses). Inside this package
  // they are just ./docs.
  original = original.replace(/ \(`node_modules\/\.bun\/[^`]*`[^)]*\)/, "");
  original = original.replaceAll("node_modules/bun-types/", "");
  if (endOfFrontMatter > -1) {
    original = original.slice(endOfFrontMatter + "---\n".length).trim() + "\n";
  }

  await Bun.write(join(outDir, "CLAUDE.md"), original);
}

// Copy docs
const docsDir = join(outDir, "docs");
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
