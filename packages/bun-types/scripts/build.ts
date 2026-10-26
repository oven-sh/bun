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

// The per-rule pages under docs/lint/rules/<plugin>/ are generated (src/codegen/lint-rule-docs.ts)
// and embedded in the bun executable for `bun lint --explain <rule>`. They are over a thousand
// files, more than the rest of the docs together, so the package keeps only the index that lists
// the rules. Links to a rule page point at bun.com instead.
const isSkippedDoc = (file: string) => file.startsWith("lint/rules/") && file !== "lint/rules/index.mdx";

// Glob paths use the platform separator; the links and the skip list use `/`.
const sourceDocFiles = Array.from(new Bun.Glob("**/*.{md,mdx}").scanSync({ cwd: sourceDocsDir }))
  .map(file => file.replaceAll("\\", "/"))
  .filter(file => !isSkippedDoc(file));

// The top-level sections of the copied docs (`runtime`, `lint`, `installation`, ...). A link to
// `/<section>...` resolves inside the package, so it is rewritten to `/docs/<section>...`.
// Other absolute links (images, blog, rule pages) are rewritten to bun.com first, so a markdown
// file under docs/images or docs/blog cannot turn them into package paths.
const copiedSections = new Set(sourceDocFiles.map(file => file.split("/")[0].replace(/\.mdx?$/, "")));
const copiedSectionPattern = Array.from(copiedSections, section => section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length)
  .join("|");
const copiedLinkRegex = new RegExp(`(!?\\[([^\\]]*)\\])\\(\\/(${copiedSectionPattern})((?:\\/|#)[^)]*)?\\)`, "g");

for (const file of sourceDocFiles) {
  const content = await Bun.file(join(sourceDocsDir, file)).text();

  const updatedContent = content
    .replace(/\$BUN_LATEST_VERSION/g, BUN_VERSION)
    // Rule pages are not copied: link to them on bun.com
    .replace(/(!?\[([^\]]*)\])\(\/lint\/rules\/([^)#]+)((?:#[^)]*)?)\)/g, "$1(https://bun.com/docs/lint/rules/$3$4)")
    // Convert non-copied content to absolute URLs (images, blog, etc.)
    .replace(/(!?\[([^\]]*)\])\(\/(images|blog)(\/[^)]*)?\)/g, "$1(https://bun.com/$3$4)")
    // Prefix copied doc paths with /docs/ (handles both links and images)
    .replace(copiedLinkRegex, "$1(/docs/$3$4)")
    .replace(/https:\/\/bun\.com\/docs\/guides\//g, "https://bun.com/guides/");

  await Bun.write(join(docsDir, file), updatedContent);
}
