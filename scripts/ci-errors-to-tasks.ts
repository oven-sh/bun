#!/usr/bin/env bun
/**
 * Parse `bun run ci:errors` output into /tmp/tasks/*.md for the
 * phase-h-ci-tasks workflow.
 *
 *   bun scripts/ci-errors-to-tasks.ts [ci-errors.txt] [out-dir]
 *
 * Only emits tasks tagged [new] (port-specific failures, not also-on-main).
 * Skips Windows (peer session is actively working on it).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const IN = Bun.argv[2] ?? "/tmp/ci-errors.txt";
const OUT = Bun.argv[3] ?? "/tmp/tasks";
const SKIP_WINDOWS = !Bun.argv.includes("--include-windows");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const raw = readFileSync(IN, "utf8");
// Sections are delimited by `== <title> == [tag]` lines.
const sections = raw.split(/^== /m).slice(1);

let tIdx = 0;
let bIdx = 0;
const index: Array<{ id: string; title: string; path: string }> = [];

for (const section of sections) {
  const headerEnd = section.indexOf("\n");
  const header = section.slice(0, headerEnd).trim();
  const body = section.slice(headerEnd + 1).trim();

  const tagMatch = header.match(/\[(\w+)\]\s*$/);
  const tag = tagMatch?.[1] ?? "";
  const title = header.replace(/\s*==\s*\[\w+\]\s*$/, "").trim();

  // Only process [new] failures — [flaky]/[also on main] are not port bugs.
  if (tag !== "new") continue;
  // Skip Windows-only failures — peer session owns it. Match title only;
  // bodies always mention every platform in the lane summary.
  if (SKIP_WINDOWS && /windows|win32/i.test(title)) continue;
  // Skip empty/noise sections.
  if (body.length < 20) continue;

  const isBuild = /build|link|compile|ninja|cargo|clang|ld:/i.test(title);
  const id = isBuild ? `B${String(++bIdx).padStart(3, "0")}` : `T${String(++tIdx).padStart(3, "0")}`;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60);
  const path = `${OUT}/${id}-${slug}.md`;

  // Truncate very long bodies (full logs); keep first 8000 chars + last 2000.
  let trimmed = body;
  if (body.length > 12000) {
    trimmed = body.slice(0, 8000) + "\n\n... [truncated] ...\n\n" + body.slice(-2000);
  }

  writeFileSync(path, `# ${title}\n\n**Tag:** [${tag}]\n\n\`\`\`\n${trimmed}\n\`\`\`\n`);
  index.push({ id, title, path });
}

writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
console.error(`wrote ${index.length} tasks → ${OUT}/ (${bIdx} build, ${tIdx} test)`);
