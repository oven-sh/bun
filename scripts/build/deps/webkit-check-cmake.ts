/**
 * Guards the hand transcription of WebKit's CMake in deps/webkit.ts.
 *
 * webkit.ts restates, by hand, three kinds of thing WebKit's CMake decides:
 * the code generators (every `gen()` mirrors an `add_custom_command`), the
 * option values that end up in cmakeconfig.h (the `rows` table mirrors
 * WEBKIT_OPTION_DEFINE / _DEFAULT_PORT_VALUE / SET_AND_EXPOSE_TO_BUILD), and
 * WebKit's own compiler flags (webkitFlags() mirrors
 * WEBKIT_*_COMPILER_FLAGS, add_compile_options, per-source COMPILE_OPTIONS).
 * This reads the CMake files those live in from the fetched tree — parsed,
 * not evaluated (scripts/build/cmake.ts) — and extracts, as canonical text:
 *
 *   - every call of a watched command (add_custom_command, the option and
 *     flag macros …) and of any macro defined there that wraps one,
 *   - every statement that assigns a variable those reference, transitively
 *     (OFFLINE_ASM_ARGS, ENABLE_FTL_DEFAULT, JavaScriptCore_BUILTINS_SOURCES …),
 *   - the DerivedSources entries of JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS
 *     (frameworkHeaders() forwards those; tree headers it forwards wholesale),
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

const snapshotPath = join(import.meta.dirname, "webkit-cmake.snapshot");
const snapshotName = "scripts/build/deps/webkit-cmake.snapshot";

/** The CMake files deps/webkit.ts transcribes from (all inside the sparse checkout). */
export const watchedFiles = [
  "Source/cmake/WebKitFeatures.cmake",
  "Source/cmake/OptionsCommon.cmake",
  "Source/cmake/OptionsJSCOnly.cmake",
  "Source/cmake/OptionsMSVC.cmake",
  "Source/cmake/WebKitCompilerFlags.cmake",
  "Source/bmalloc/CMakeLists.txt",
  "Source/WTF/wtf/CMakeLists.txt",
  "Source/WTF/wtf/PlatformJSCOnly.cmake",
  "Source/JavaScriptCore/CMakeLists.txt",
];

/** Commands whose every call is captured (lower-case). */
const watchedCommands = new Set([
  // generators → gen() steps
  "add_custom_command",
  "add_custom_target",
  // options → the cmakeconfig.h `rows` table
  "webkit_option_define",
  "webkit_option_default_port_value",
  "webkit_option_depend",
  "webkit_option_conflict",
  "set_and_expose_to_build",
  "expose_variable_to_build",
  "expose_string_variable_to_build",
  // compiler / linker flags → webkitFlags(), per-source cflags
  "webkit_prepend_global_compiler_flags",
  "webkit_append_global_compiler_flags",
  "webkit_prepend_global_cxx_flags",
  "webkit_append_global_cxx_flags",
  "webkit_prepend_global_c_flags",
  "webkit_append_global_c_flags",
  "webkit_add_target_cxx_flags",
  "webkit_add_target_c_flags",
  "webkit_add_compiler_flags",
  "add_compile_options",
  "add_compile_definitions",
  "add_definitions",
  "remove_definitions",
  "add_link_options",
  "target_compile_options",
  "target_compile_definitions",
  "set_source_files_properties",
]);

/**
 * Variables captured even though no watched call references them, with an
 * optional filter on which arguments of their assignments matter.
 * JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS: only its DerivedSources entries
 * are transcribed (frameworkHeaders()); the ~900 tree headers are forwarded
 * by directory, so listing them would only add noise to every bump.
 */
const watchedVariables = new Map<string, ((arg: string) => boolean) | undefined>([
  ["JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS", arg => !/^[A-Za-z0-9_/.-]+\.(h|def)$/.test(arg)],
]);

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
  /^(CMAKE_|JAVASCRIPTCORE_DIR$|JavaScriptCore_(DERIVED_SOURCES|SCRIPTS|FRAMEWORK_HEADERS|PRIVATE_FRAMEWORK_HEADERS)_DIR$|WTF_(DERIVED_SOURCES_DIR|SCRIPTS_DIR|DIR)$|(PYTHON|PERL|Ruby|Python|Mig)_EXECUTABLE$|PORT$|WTF_(CPU|OS|PLATFORM)_|WIN32$|APPLE$|UNIX$|MSVC$)/;

/** Which variable (if any) a statement assigns. Over-approximates for string()/file()/math(): any of their unquoted arguments may be the output. */
function assignedVariables(inv: Invocation): string[] {
  const a = inv.args;
  switch (inv.name) {
    case "set":
    case "unset":
    case "option":
    case "set_and_expose_to_build":
    case "webkit_option_define":
    case "webkit_option_default_port_value":
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
    const invs = parseCMake(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), rel);

    // Macros/functions defined here whose body declares a step: their call sites carry the real arguments.
    const wrapperNames = new Set<string>();
    for (const inv of invs) {
      if (!watchedCommands.has(inv.name)) continue;
      for (const c of inv.context) {
        const m = /^(?:macro|function)\(([A-Za-z_][A-Za-z0-9_]*)/.exec(c);
        if (m) wrapperNames.add(m[1]!.toLowerCase());
      }
    }

    const watched = new Set<Invocation>();
    const wanted = new Set<string>(watchedVariables.keys()); // variable names to chase
    const chase = (inv: Invocation) => {
      if (watched.has(inv)) return;
      watched.add(inv);
      for (const arg of inv.args) for (const v of variableReferences(arg)) if (!environment.test(v)) wanted.add(v);
      // A foreach header's list is an input too (the LUT sources, the domains).
      for (const c of inv.context)
        if (c.startsWith("foreach("))
          for (const m of c.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) if (!environment.test(m[1]!)) wanted.add(m[1]!);
    };
    for (const inv of invs) if (watchedCommands.has(inv.name) || wrapperNames.has(inv.name)) chase(inv);
    // Transitive closure over assignments (a handful of rounds suffices; bound it anyway).
    for (let round = 0; round < 20; round++) {
      const before = watched.size;
      for (const inv of invs) if (assignedVariables(inv).some(v => wanted.has(v))) chase(inv);
      if (watched.size === before) break;
    }

    blocks.push(`#### ${rel}`);
    for (const inv of invs) {
      if (!watched.has(inv)) continue;
      const filter = assignedVariables(inv)
        .map(v => watchedVariables.get(v))
        .find(f => f !== undefined);
      if (inv.name === "webkit_option_define") {
        // (name "description" PUBLIC|PRIVATE default): the description is prose.
        blocks.push(renderInvocation({ ...inv, args: inv.args.filter((_a, i) => i !== 1) }, keywords));
      } else if (filter) {
        const named = inv.name === "set" ? 1 : 2; // leading name / keyword+name arguments
        const kept = inv.args.filter((a, i) => i < named || filter(a.text));
        if (kept.length === named) continue; // nothing transcribed from this statement
        blocks.push(renderInvocation({ ...inv, args: kept }, keywords));
      } else blocks.push(renderInvocation(inv, keywords));
    }
  }
  const header = [
    "# WebKit CMake statements that scripts/build/deps/webkit.ts transcribes by hand:",
    "# code generators (add_custom_command → gen()), options (WEBKIT_OPTION_* /",
    "# SET_AND_EXPOSE_TO_BUILD → the cmakeconfig.h rows), compiler flags",
    "# (WEBKIT_*_COMPILER_FLAGS, add_compile_options … → webkitFlags()), the macros",
    "# wrapping them and the variables they use — rendered canonically by",
    "# webkit-check-cmake.ts from the fetched tree and compared on every build.",
    "# When this changes upstream, carry the change into webkit.ts, then refresh:",
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

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  const [root, stampOrFlag] = process.argv.slice(2);
  if (root === undefined || stampOrFlag === undefined) {
    console.error("usage: webkit-check-cmake.ts <WebKit root> (<stamp> | --update)");
    process.exit(2);
  }
  const current = extract(root);
  if (stampOrFlag === "--update") {
    writeFileSync(snapshotPath, current);
    console.log(`wrote ${snapshotName} (${current.split("\n").length} lines)`);
    process.exit(0);
  }
  // CRLF-insensitive: a Windows checkout with core.autocrlf rewrites the snapshot's line endings.
  const expected = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== expected) {
    console.error(
      `WebKit's CMake differs from ${snapshotName}:\n\n` +
        unifiedDiff(expected, current) +
        `\n\nThese are the CMake statements scripts/build/deps/webkit.ts transcribes by hand:\n` +
        `add_custom_command → a gen() step, WEBKIT_OPTION_* / SET_AND_EXPOSE_TO_BUILD → the\n` +
        `cmakeconfig.h rows table, WEBKIT_*_FLAGS / add_compile_options / COMPILE_OPTIONS →\n` +
        `webkitFlags() or a per-source cflags. Read the diff, make the matching change to\n` +
        `webkit.ts (or decide none is needed), then refresh the snapshot:\n` +
        `  bun scripts/build/deps/webkit-check-cmake.ts vendor/WebKit --update`,
    );
    process.exit(1);
  }
  writeFileSync(stampOrFlag, `${current.length}\n`);
}
