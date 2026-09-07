/**
 * Fails when JSC's Sources.txt lists (the files WebKit's cmake would compile,
 * as unified bundles or @no-unify) and the checked-in lists in
 * webkit-jsc-sources.ts (jscUnifiedBundles + jscNonUnifiedSources) disagree —
 * i.e. a WebKit bump added, removed or renamed a translation unit and the
 * lists were not updated. Run by one dep step (deps/webkit.ts) after the
 * fetch and before any JSC compile, so the message is this one and not an
 * undefined symbol at link.
 *
 *   webkit-check-sources.ts <Source/JavaScriptCore dir> <stamp>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jscNonUnifiedSources, jscUnifiedBundles } from "./webkit-jsc-sources.ts";

const [jscDir, stamp] = process.argv.slice(2);
if (jscDir === undefined || stamp === undefined) {
  console.error("usage: webkit-check-sources.ts <Source/JavaScriptCore dir> <stamp>");
  process.exit(2);
}

/** The lists WebKit's generate-unified-source-bundles.py reads for the JSCOnly port. */
const sourceLists = ["Sources.txt", "inspector/remote/SourcesSocket.txt"];

/** path → whether Sources.txt forces it out of the bundles (@no-unify; the conditional @no-unify-when(bundle<=8) applies at WebKit's bundle size of 8). */
const upstream = new Map<string, boolean>();
for (const list of sourceLists) {
  for (const raw of readFileSync(join(jscDir, list), "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    const [path, ...attrs] = line.split(/\s+/);
    // Sources.txt carries a couple of headers (wasm/js/JSToWasm.h); like
    // WebKit's bundler, only translation units count.
    if (!/\.(cpp|c|cc|mm)$/.test(path!)) continue;
    upstream.set(
      path!,
      attrs.some(a => a === "@no-unify" || a.startsWith("@no-unify-when")),
    );
  }
}

const bundled = new Map<string, string>(); // path → bundle
for (const [bundle, members] of jscUnifiedBundles) for (const m of members) bundled.set(m, bundle);
const standalone = new Set(jscNonUnifiedSources.filter(s => !s.startsWith("DerivedSources/")));

const problems: string[] = [];
for (const [path, noUnify] of upstream) {
  const inBundle = bundled.get(path);
  if (inBundle === undefined && !standalone.has(path)) {
    problems.push(
      noUnify
        ? `+ ${path}: in Sources.txt (@no-unify), missing from jscNonUnifiedSources`
        : `+ ${path}: in Sources.txt, missing from jscUnifiedBundles (add it to a UnifiedSource-<dir>-N.cpp bundle of its directory with fewer than 8 entries, or start a new one)`,
    );
  } else if (inBundle !== undefined && noUnify) {
    problems.push(
      `~ ${path}: Sources.txt marks it @no-unify but it is inside ${inBundle}; move it to jscNonUnifiedSources`,
    );
  } else if (inBundle === undefined && !noUnify) {
    problems.push(`~ ${path}: listed in jscNonUnifiedSources but Sources.txt bundles it; move it into a bundle`);
  }
}
for (const path of [...bundled.keys(), ...standalone]) {
  if (!upstream.has(path))
    problems.push(`- ${path}: listed in webkit-jsc-sources.ts but no longer in Sources.txt; remove it`);
}

if (problems.length > 0) {
  console.error(
    `webkit-jsc-sources.ts is out of date with ${sourceLists.join(" + ")} (${problems.length}):\n` +
      problems.map(p => `  ${p}`).join("\n") +
      `\nUpdate scripts/build/deps/webkit-jsc-sources.ts (see .claude/commands/upgrade-webkit.md).`,
  );
  process.exit(1);
}
writeFileSync(stamp, `${upstream.size} sources\n`);
