// Packs the lint rule docs, `docs/lint/rules/<plugin>/<rule>.mdx`, into one file that is embedded in the executable.
//
// For each page it has a NUL, `<plugin>/<rule>`, a newline, then the page's Markdown. The Markdown is the description
// from the frontmatter on one line, an empty line, then the page without its frontmatter and MDX comments. A code
// block's file name moves to a line above the block.
//
// The pages are sorted by `<plugin>/<rule>`. `src/lint/driver/explain.rs` reads the file: `bun lint --rules` the
// descriptions, `bun lint --explain <rule>` a page.
//
// usage: bun generate-lint-docs.ts <docs/lint/rules> <pages>
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readdirRecursive, writeIfNotChanged } from "./helpers.ts";

const [root, pagesPath] = process.argv.slice(2);
if (!root || !pagesPath) {
  console.error("usage: generate-lint-docs.ts <docs/lint/rules> <pages>");
  process.exit(1);
}

/** Returns the value of `key` in `frontmatter`. A value is one line, with or without double quotes. */
function field(frontmatter: string, key: string): string {
  const value = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(frontmatter)?.[1] ?? "";
  if (!value.startsWith('"')) return value;
  try {
    return String(JSON.parse(value));
  } catch {
    return value;
  }
}

/**
 * Removes MDX comments. Code blocks are left alone, because `{/* .. *\/}` is a JSX comment there.
 * A terminal doesn't show the file name after a code block's language, so it becomes a paragraph of its own.
 */
function forTerminal(markdown: string): string {
  const lines: string[] = [];
  let fence = "";
  for (const line of markdown.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence) && line.trim() === marker) fence = "";
    } else if (marker) {
      fence = marker;
      const [, start, name] = /^(\s*[`~]+\S+)\s+(\S.*?)\s*$/.exec(line) ?? [];
      if (name) {
        if (lines.at(-1)) lines.push("");
        lines.push("`" + name + "`", "", start);
        continue;
      }
    } else if (line.includes("{/*")) {
      const rest = line.replace(/\{\/\*.*?\*\/\}/g, "");
      if (rest.trim()) lines.push(rest);
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

const names = readdirRecursive(root)
  .filter(path => path.endsWith(".mdx"))
  .map(path => relative(root, path).slice(0, -".mdx".length).split(sep).join("/"))
  // Pages outside a plugin's directory aren't about a rule.
  .filter(name => name.includes("/"))
  .sort((a, b) => (a < b ? -1 : 1));

let pages = "";
for (const name of names) {
  const text = readFileSync(join(root, name + ".mdx"), "utf8").replaceAll("\r\n", "\n");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const description = field(frontmatter?.[1] ?? "", "description").replace(/\s+/g, " ");
  const body = forTerminal(text.slice(frontmatter?.[0].length ?? 0)).replaceAll("\0", "");
  pages += `\0${name}\n${description}\n\n${body.trim()}\n`;
}
writeIfNotChanged(pagesPath, pages);
