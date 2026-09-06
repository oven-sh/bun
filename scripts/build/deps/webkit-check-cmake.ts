/**
 * Guards the hand transcription of WebKit's code generators in deps/webkit.ts.
 *
 * Every `gen()` step there mirrors an `add_custom_command` in WebKit's CMake
 * (JSC's DerivedSources generators, the LLInt offlineasm pipeline, WTF's MIG
 * stubs). This reads those CMake files from the fetched tree — parsed, not
 * evaluated (scripts/build/cmake.ts) — and extracts, as canonical text:
 *
 *   - every add_custom_command / add_custom_target,
 *   - every call of a macro defined there that wraps one (GENERATE_HASH_LUT …),
 *   - every statement that assigns a variable those reference, transitively
 *     (OFFLINE_ASM_ARGS, LLINT_ASM, JavaScriptCore_BUILTINS_SOURCES …),
 *
 * each with the if/foreach/macro blocks enclosing it. That text is compared
 * with the checked-in snapshot (webkit-cmake.snapshot). A WebKit bump that
 * touches any of it fails the build with the diff, so the change is carried
 * into webkit.ts by someone who has read it; then `--update` refreshes the
 * snapshot. Formatting-only edits upstream do not show (the rendering is
 * canonical); unrelated CMake changes do not show (they are not extracted).
 *
 *   webkit-check-cmake.ts <WebKit root> <stamp>     check (build step)
 *   webkit-check-cmake.ts <WebKit root> --update    rewrite the snapshot
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Invocation, parseCMake, renderInvocation, variableReferences } from "../cmake.ts";

const [root, stampOrFlag] = process.argv.slice(2);
if (root === undefined || stampOrFlag === undefined) {
  console.error("usage: webkit-check-cmake.ts <WebKit root> (<stamp> | --update)");
  process.exit(2);
}
const snapshotPath = join(import.meta.dirname, "webkit-cmake.snapshot");
const snapshotName = "scripts/build/deps/webkit-cmake.snapshot";

/** The CMake files whose generators deps/webkit.ts transcribes. */
const watchedFiles = ["Source/JavaScriptCore/CMakeLists.txt", "Source/WTF/wtf/PlatformJSCOnly.cmake"];

/** Statements that define build steps. */
const stepCommands = new Set(["add_custom_command", "add_custom_target"]);
/** Keyword arguments that start a new line in the rendering (readability of the diff only). */
const keywords = new Set([
  "OUTPUT",
  "COMMAND",
  "DEPENDS",
  "MAIN_DEPENDENCY",
  "BYPRODUCTS",
  "WORKING_DIRECTORY",
  "COMMENT",
  "VERBATIM",
  "APPEND",
  "SOURCES",
  "ALL",
]);
/**
 * Variables supplied by the surrounding WebKit build (directories, tools,
 * platform switches) rather than by these files' own logic. References to
 * them are not chased; deps/webkit.ts maps them to bun's own paths/config.
 */
const environment =
  /^(CMAKE_|JAVASCRIPTCORE_DIR$|JavaScriptCore_(DERIVED_SOURCES|SCRIPTS|FRAMEWORK_HEADERS|PRIVATE_FRAMEWORK_HEADERS)_DIR$|WTF_(DERIVED_SOURCES_DIR|SCRIPTS_DIR|DIR)$|(PYTHON|PERL|Ruby|Python|Mig)_EXECUTABLE$|PORT$|WTF_(CPU|OS|PLATFORM)_|ENABLE_|USE_|HAVE_|WIN32$|APPLE$|UNIX$|MSVC$)/;

/** Which variable (if any) a statement assigns. Over-approximates for string()/file()/math(): any of their unquoted arguments may be the output. */
function assignedVariables(inv: Invocation): string[] {
  const a = inv.args;
  switch (inv.name) {
    case "set":
    case "unset":
    case "option":
      return a[0] ? [a[0].text] : [];
    case "list":
      return a[1] ? [a[1].text] : [];
    case "string":
    case "file":
    case "math":
    case "get_filename_component":
    case "cmake_path":
    case "execute_process":
      return a.filter(x => x.kind === "unquoted" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.text)).map(x => x.text);
    default:
      return [];
  }
}

function extract(rootDir: string): string {
  const blocks: string[] = [];
  for (const rel of watchedFiles) {
    const path = join(rootDir, rel);
    const invs = parseCMake(readFileSync(path, "utf8"), rel);

    // Macros/functions defined here whose body declares a step: their call sites carry the real arguments.
    const wrapperNames = new Set<string>();
    for (const inv of invs) {
      if (!stepCommands.has(inv.name)) continue;
      for (const c of inv.context) {
        const m = /^(?:macro|function)\(([A-Za-z_][A-Za-z0-9_]*)/.exec(c);
        if (m) wrapperNames.add(m[1]!.toLowerCase());
      }
    }

    const watched = new Set<Invocation>();
    const wanted = new Set<string>(); // variable names to chase
    const chase = (inv: Invocation) => {
      if (watched.has(inv)) return;
      watched.add(inv);
      for (const arg of inv.args) for (const v of variableReferences(arg)) if (!environment.test(v)) wanted.add(v);
      // A foreach header's list is an input too (the LUT sources, the domains).
      for (const c of inv.context)
        if (c.startsWith("foreach("))
          for (const m of c.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) if (!environment.test(m[1]!)) wanted.add(m[1]!);
    };
    for (const inv of invs) if (stepCommands.has(inv.name) || wrapperNames.has(inv.name)) chase(inv);
    // Transitive closure over assignments (a handful of rounds suffices; bound it anyway).
    for (let round = 0; round < 20; round++) {
      const before = watched.size;
      for (const inv of invs) if (assignedVariables(inv).some(v => wanted.has(v))) chase(inv);
      if (watched.size === before) break;
    }

    blocks.push(`#### ${rel}`);
    for (const inv of invs) if (watched.has(inv)) blocks.push(renderInvocation(inv, keywords));
  }
  const header = [
    "# WebKit CMake statements that scripts/build/deps/webkit.ts transcribes by hand:",
    "# code generators (add_custom_command), the macros wrapping them, and the",
    "# variables they use — rendered canonically by webkit-check-cmake.ts from the",
    "# fetched tree and compared on every build. When this changes upstream, carry",
    "# the change into webkit.ts, then refresh with:",
    "#   bun scripts/build/deps/webkit-check-cmake.ts vendor/WebKit --update",
  ].join("\n");
  return [header, ...blocks].join("\n\n") + "\n";
}

/** Minimal unified line diff (LCS), enough to show what moved. */
function unifiedDiff(oldText: string, newText: string, context = 3): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  // Trim common prefix/suffix to keep the DP small.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ha = a.length,
    hb = b.length;
  while (ha > lo && hb > lo && a[ha - 1] === b[hb - 1]) {
    ha--;
    hb--;
  }
  const A = a.slice(lo, ha),
    B = b.slice(lo, hb);
  const n = A.length,
    m = B.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  type Op = { kind: " " | "-" | "+"; text: string };
  const ops: Op[] = [];
  for (let k = Math.max(0, lo - context); k < lo; k++) ops.push({ kind: " ", text: a[k]! });
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      ops.push({ kind: " ", text: A[i]! });
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) ops.push({ kind: "-", text: A[i++]! });
    else ops.push({ kind: "+", text: B[j++]! });
  }
  for (let k = ha; k < Math.min(a.length, ha + context); k++) ops.push({ kind: " ", text: a[k]! });
  // Collapse long unchanged runs.
  const out: string[] = [];
  let run: Op[] = [];
  const flushRun = (final: boolean) => {
    if (run.length > 2 * context && !final) {
      out.push(
        ...run.slice(0, context).map(o => ` ${o.text}`),
        `@@ … ${run.length - 2 * context} unchanged lines … @@`,
        ...run.slice(-context).map(o => ` ${o.text}`),
      );
    } else out.push(...run.map(o => ` ${o.text}`));
    run = [];
  };
  for (const op of ops) {
    if (op.kind === " ") run.push(op);
    else {
      flushRun(false);
      out.push(`${op.kind}${op.text}`);
    }
  }
  flushRun(true);
  return out.join("\n");
}

const current = extract(root);
if (stampOrFlag === "--update") {
  writeFileSync(snapshotPath, current);
  console.log(`wrote ${snapshotName} (${current.split("\n").length} lines)`);
  process.exit(0);
}
const expected = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : "";
if (current !== expected) {
  console.error(
    `WebKit's CMake code-generation statements differ from ${snapshotName}:\n\n` +
      unifiedDiff(expected, current) +
      `\n\nThese are the add_custom_command generators (and the variables feeding them) that\n` +
      `scripts/build/deps/webkit.ts transcribes as gen() steps. Read the diff, make the matching\n` +
      `change to webkit.ts (or decide none is needed), then refresh the snapshot:\n` +
      `  bun scripts/build/deps/webkit-check-cmake.ts vendor/WebKit --update`,
  );
  process.exit(1);
}
writeFileSync(stampOrFlag, `${current.length}\n`);
