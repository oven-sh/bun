#!/usr/bin/env bun
// Fix-up for migrate-hostfn-vm.ts: move the `use bun_jsc::virtual_machine::VirtualMachine;`
// line out of the `//!` inner-doc-comment block (and dedupe / drop when redundant).

import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";

const TARGET = "use bun_jsc::virtual_machine::VirtualMachine;";

for (const file of [
  ...new Glob("src/runtime/**/*.rs").scanSync("."),
  ...new Glob("src/sql_jsc/**/*.rs").scanSync("."),
]) {
  let txt = readFileSync(file, "utf8");
  if (!txt.includes(TARGET)) continue;

  const lines = txt.split("\n");
  // remove every existing TARGET line
  const filtered = lines.filter(l => l.trim() !== TARGET);

  // do we still need the import? (any `&VirtualMachine`/`: VirtualMachine` ref
  // not already covered by another `use … VirtualMachine`)
  const body = filtered.join("\n");
  const needsType = /\bVirtualMachine\b/.test(body);
  // already imported via some other path?
  const hasImport =
    /use [^;]*\bVirtualMachine\b[^;]*;/s.test(body) &&
    !/use [^;]*\bVirtualMachine(?:Ref|SqlExt|InitOptions)\b/s.test(
      body.match(/use [^;]*\bVirtualMachine\b[^;]*;/s)?.[0] ?? "",
    );

  if (!needsType) {
    writeFileSync(file, body);
    continue;
  }
  if (hasImport) {
    writeFileSync(file, body);
    continue;
  }

  // find first line that is not `//!`, not blank, not `#![…]`
  let insertAt = 0;
  for (let i = 0; i < filtered.length; i++) {
    const t = filtered[i].trimStart();
    if (t.startsWith("//!") || t.startsWith("#![") || t === "") {
      insertAt = i + 1;
      continue;
    }
    break;
  }
  filtered.splice(insertAt, 0, TARGET);
  writeFileSync(file, filtered.join("\n"));
}
