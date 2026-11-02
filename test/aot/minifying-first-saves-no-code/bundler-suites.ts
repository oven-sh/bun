// The inputs of the bundler's own tests: what test/bundler hands to `itBundled` in the files about minifying, unused code, enums, namespaces and `import *`. Each file is loaded with
// ./stand-ins-for-the-bundler-tests.ts in the place of "bun:test" and of expectBundled.ts, so none of its tests runs here. What those tests expect is not read.
//
// The checker refuses a name that is nowhere, so a file in TypeScript begins with `// @ts-nocheck` here.
// Most of these inputs only exist to be printed: they name things that are nowhere. Such a case is compiled and not run. One whose test runs the bundle is run here too.
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Case } from "../minifying-first-saves-no-code";
import { dedent, inputs } from "./stand-ins-for-the-bundler-tests";

export const suites = [
  "bundler_minify.test.ts",
  "bundler_minify_symbol_for.test.ts",
  "bundler_merged_enum.test.ts",
  "bundler_string.test.ts",
  "esbuild/dce.test.ts",
  "esbuild/default.test.ts",
  "esbuild/extra.test.ts",
  "esbuild/importstar.test.ts",
  "esbuild/importstar_ts.test.ts",
  "esbuild/ts.test.ts",
] as const;

const folder = join(import.meta.dir, "..", "..", "bundler");
const standIns = JSON.stringify(join(import.meta.dir, "stand-ins-for-the-bundler-tests.ts"));

plugin({
  name: "the inputs of the bundler's tests",
  setup(build) {
    build.onLoad({ filter: /[\\/]test[\\/]bundler[\\/](esbuild[\\/])?\w+\.test\.ts$/ }, ({ path }) => ({
      contents: readFileSync(path, "utf8").replace(
        /^(import .* from )"(?:bun:test|\.\.?\/expectBundled)";$/gm,
        `$1${standIns};`,
      ),
      loader: "ts",
    }));
  },
});

// What says how the bundle is printed, where it goes and what the test looks for in it. None of it changes what the program does.
const aboutTheOutput = new Set([
  "files", "entryPoints", "run", "define", "minifySyntax", "minifyWhitespace", "minifyIdentifiers", "onAfterBundle", "capture", "dce", "dceKeepMarkerCount", "outfile", "outdir", "format",
  "target", "sourceMap", "bundleWarnings", "backend", "mode", "bundling", "keepNames", "snapshot", "snapshotSourceMap", "expectExactFilesize", "matchesReference", "assertNotPresent",
  "todo", "notImplemented", "skipOnEsbuild", "treeShaking", "emitDCEAnnotations", "outputPaths", "entryNaming", "timeoutScale", "debugTimeoutScale", "legalComments", "platform", "metafile",
  "unsupportedJSFeatures", "unsupportedCSSFeatures", "host", "cjs2esm", "production", "runtimeFiles", "globalName", "skipIfWeDidNotImplementWildcardSideEffects",
]); // prettier-ignore

const isTaken = (path: string) => /\.([cm]?[jt]s|json|txt)$/.test(path);

function whyLeftOut(input: Record<string, any>): string | undefined {
  if (input.bundleErrors) return "the bundler refuses it";
  const other = Object.keys(input).find(key => !aboutTheOutput.has(key) && input[key] !== undefined);
  if (other) return `it sets ${other}`;
  for (const [path, text] of Object.entries(input.files ?? {})) {
    if (typeof text !== "string") return "a file that is no text";
    if (!isTaken(path)) return `a file ${path.slice(path.lastIndexOf("."))}`;
    if (text.includes("{{root}}")) return "it names its folder";
  }
  if (!Object.keys(input.files ?? {}).length) return "no files";
}

// An unused read of a `let`, `const` or class ahead of its declaration: the minifier and `bun run` remove it, and compiled code throws as the language says
// (docs/compiler/compatibility.mdx: "An unused read of a `let`, `const` or local class before its declaration has run"). By the name of the case, the error.
const errorsThatTheMinifierRemoves: Record<string, string> = {
  "esbuild/dce: dce/DCETypeOf": "ReferenceError: Cannot access 'c_remove' before initialization",
};

const below = (path: string) => path.replace(/^\/+/, "");
const isRun = ({ run, runtimeFiles }: Record<string, any>) => !!run && !Array.isArray(run) && !runtimeFiles && !(typeof run === "object" && (run.file || run.error || run.errorLineMatch || run.args || run.bunArgs || run.env || run.partialStdout || run.validate)); // prettier-ignore

export const leftOut: Record<string, number> = {};

/** The cases of one suite, by the name its test has. An input with several entry points is a case for each. */
export async function casesOfSuite(suite: (typeof suites)[number]) {
  inputs.length = 0;
  await import(join(folder, suite));
  const cases: Record<string, Case> = {};
  for (const [id, input] of inputs) {
    const why = whyLeftOut(input);
    if (why) {
      leftOut[why] = (leftOut[why] ?? 0) + 1;
      continue;
    }
    const files = Object.fromEntries(Object.entries<string>(input.files).map(([path, text]) => [below(path), (/\.[cm]?ts$/.test(path) && !text.startsWith("#!") ? "// @ts-nocheck\n" : "") + dedent(text) + "\n"])); // prettier-ignore
    const entryPoints: string[] = (input.entryPoints ?? [Object.keys(input.files)[0]]).map(below);
    for (const [index, entry] of entryPoints.entries()) {
      if (!(entry in files)) continue;
      let name = `${suite.replace(".test.ts", "")}: ${id}${index ? ` #${index + 1}` : ""}`;
      while (name in cases) name += "'";
      const errorThatTheMinifierRemoves = errorsThatTheMinifierRemoves[name];
      const runs = errorThatTheMinifierRemoves !== undefined || (isRun(input) && entryPoints.length === 1);
      cases[name] = { files, entry, define: input.define, runs, errorThatTheMinifierRemoves };
    }
  }
  // A suite is loaded once in a process.
  for (const name in errorsThatTheMinifierRemoves)
    if (inputs.length && name.startsWith(suite.replace(".test.ts", "") + ": ") && !(name in cases))
      throw new Error(`no input of test/bundler/${suite} is the case ${name}`);
  return cases;
}
