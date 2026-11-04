// No line of the compiler may compare the text of a name of the program with a literal: ./names-compared-as-text.ts says what counts as one.
// A finding goes away by asking about the binding, the object or the cell. Where the text is the build's own, the file gets an entry in `allowed` there, with its reason.
//
// A lint that finds nothing proves nothing, so names-compared-as-text-control.txt holds it to its word. A line that begins with `finds` or `allows` is a mark,
// and a snippet runs from its mark to the next one. The lint gets each snippet alone.
//   finds <path> <pattern>    exactly one line is reported, under that pattern. If a line ends in `// here`, it is that line
//   allows <path> <why>       no line is reported. If the path is the reason, the same lines are reported under an ordinary path
import { describe, expect, test } from "bun:test";
import { isCI, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  allowed,
  findInSource,
  findNamesComparedAsText,
  pathsRead,
  reasonToAllow,
  rootsOfThisCheckout,
  type Language,
} from "./names-compared-as-text";

// prettier-ignore
const patternsWithRedLine: Record<Language, string[]> = {
  "C++": [
    "==", "!=", "equal", "equalSpans", "startsWith", "endsWith", "startsWithIgnoringASCIICase",
    "contains", "containsIgnoringASCIICase", "find", "reverseFind", "spanHasPrefix", "spanHasSuffix",
    "starts_with", "ends_with", "strcmp", "strncmp", "memcmp", "case", "switch over a hash",
  ],
  Rust: [
    "==", "!=", "starts_with", "ends_with", "contains", "contains_key", "contains_char", "find", "rfind",
    "strip_prefix", "strip_suffix", "eq", "ne", "eq_ignore_ascii_case", "matches!", "match", "let",
  ],
};
const ordinaryPath: Record<Language, string> = { "C++": "aot/walk/AOTWalk.cpp", Rust: "src/aot/lower/call.rs" };
const foldersOfLoad = Object.keys(rootsOfThisCheckout.load!);
const roots = ["aot/", "src/aot/", ...foldersOfLoad];
const languageOf = (path: string): Language => (path.endsWith(".rs") ? "Rust" : "C++");

type Snippet = { verdict: string; path: string; note: string; lineOfMark: number; lines: string[] };
const snippets: Snippet[] = [];
readFileSync(join(import.meta.dir, "names-compared-as-text-control.txt"), "utf8")
  .split(/\r?\n/)
  .forEach((text, index) => {
    const mark = /^(finds|allows)\b\W*(\S*)\s*(.*?)\s*$/.exec(text);
    if (mark) snippets.push({ verdict: mark[1]!, path: mark[2]!, note: mark[3]!, lineOfMark: index + 1, lines: [] });
    else snippets.at(-1)?.lines.push(text);
  });
const red = snippets.filter(({ verdict }) => verdict === "finds");
const green = snippets.filter(({ verdict }) => verdict === "allows");

describe("the control of the lint", () => {
  for (const { verdict, path, note, lineOfMark, lines } of snippets) {
    test(`line ${lineOfMark}: ${verdict} ${note} in ${path}`, () => {
      expect(roots.some(root => path.startsWith(root))).toBe(true);
      expect(path).toMatch(/\.(?:h|cpp|rs)$/);
      const source = lines.join("\n");
      const found = findInSource(path, source).map(({ line, pattern }) => ({ line, pattern }));
      if (verdict === "finds") {
        const here = lines.findIndex(text => /\/\/ here\s*$/.test(text));
        expect(found).toEqual([{ line: here < 0 ? expect.any(Number) : here + 1, pattern: note }]);
      } else {
        expect(source).toMatch(/\S/);
        expect(found).toEqual([]);
        if (lines.some(text => reasonToAllow(path, text.trim()) !== undefined))
          expect(findInSource(ordinaryPath[languageOf(path)], source)).not.toEqual([]);
      }
    });
  }

  for (const [language, patterns] of Object.entries(patternsWithRedLine)) {
    test(`has a red line for each pattern in ${language}`, () => {
      const marked = red.filter(({ path }) => languageOf(path) === language).map(({ note }) => note);
      expect(patterns.filter(pattern => !marked.includes(pattern))).toEqual([]);
    });
  }

  test("has a green line for each entry of `allowed`", () => {
    // An entry that covers TypeScript needs no green line: the lint does not read TypeScript.
    const typeScriptFiles = ["aot/builtins/array.builtins.ts", "aot/builtins/generator/emit-cpp-names.ts"];
    const withoutGreenLine = allowed.filter(
      ({ paths, lines: allowedLines }) =>
        !typeScriptFiles.some(path => paths.test(path)) &&
        !green.some(
          ({ path, lines }) =>
            paths.test(path) && (!allowedLines || lines.some(text => allowedLines.test(text.trim()))),
        ),
    );
    expect(withoutGreenLine.map(({ reason }) => reason)).toEqual([]);
  });

  test("has a red line under each root", () => {
    expect(roots.filter(root => !red.some(({ path }) => path.startsWith(root)))).toEqual([]);
  });

  // The tests above pass text to the lint. The tests of the real trees below pass folders, and a walk that finds no files reports nothing too.
  // What lies in aot/ and src/aot/ shares one folder, and each folder of `load` has its own, as in a checkout.
  test("is found again in the files of a folder", () => {
    using folder = tempDir(
      "names-compared-as-text",
      Object.fromEntries(
        snippets.map(({ verdict, path, lines }, index) => {
          const root = roots.find(root => path.startsWith(root))!;
          const name = verdict === "finds" ? `red-${index}${extname(path)}` : path.slice(root.length);
          return [(foldersOfLoad.includes(root) ? root : "trees/") + name, lines.join("\n")];
        }),
      ),
    );
    const load = Object.fromEntries(foldersOfLoad.map(root => [root, join(String(folder), root)]));
    const found = findNamesComparedAsText({ frontEnd: join(String(folder), "trees"), load });
    expect(found.map(({ pattern }) => pattern).sort()).toEqual(red.map(({ note }) => note).sort());
  });
});

const whyNoEngine = rootsOfThisCheckout.engine
  ? undefined
  : "there is no checkout of the engine's sources ($BUN_WEBKIT_PATH, vendor/WebKit)";
const isEngineSkipped = whyNoEngine !== undefined && !isCI;
if (isEngineSkipped)
  console.error(`SKIPPED: compiler/names-compared-as-text.test.ts: the engine's C++: ${whyNoEngine}`);

describe("no name is compared as text", () => {
  test("in the front end's Rust", () => {
    const { frontEnd, load } = rootsOfThisCheckout;
    const read = pathsRead({ frontEnd, load });
    expect(roots.slice(1).filter(root => !read.some(path => path.startsWith(root)))).toEqual([]);
    expect(findNamesComparedAsText({ frontEnd, load }).map(String)).toEqual([]);
  }, 600_000);

  test.skipIf(isEngineSkipped)(
    whyNoEngine ? `in the engine's C++: ${whyNoEngine}` : "in the engine's C++",
    () => {
      expect(whyNoEngine).toBeUndefined();
      expect(findNamesComparedAsText({ engine: rootsOfThisCheckout.engine }).map(String)).toEqual([]);
    },
    600_000,
  );
});
