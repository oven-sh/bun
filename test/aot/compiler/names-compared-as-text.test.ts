// No line of the compiler may compare the text of a name of the program with a literal: ./names-compared-as-text.ts says what counts as one.
// A finding goes away by asking about the binding, the object or the cell. Where the text is the build's own, the file gets an entry in `allowed` there, with its reason.
//
// A lint that finds nothing proves nothing, so names-compared-as-text-control.txt holds it to its word. A line that begins with `finds` or `allows` is a mark,
// and a snippet runs from its mark to the next one. The lint gets each snippet alone.
//   finds <path> <pattern>    exactly one line is reported, under that pattern. If a line ends in `// here`, it is that line
//   allows <path> <why>       no line is reported. If the path is the reason, the same lines are reported under an ordinary path
import { describe, expect } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../harness/default-timeout";
import {
  allowed,
  findInSource,
  findNamesComparedAsText,
  pathsRead,
  reasonToAllow,
  rootsOfThisCheckout,
} from "./names-compared-as-text";

// prettier-ignore
const patternsWithRedLine = [
  "==", "!=", "starts_with", "ends_with", "contains", "contains_key", "contains_char", "find", "rfind",
  "strip_prefix", "strip_suffix", "eq", "ne", "eq_ignore_ascii_case", "matches!", "match", "let",
];
const ordinaryPath = "src/aot/lower/call.rs";
const foldersOfLoad = Object.keys(rootsOfThisCheckout.load!);
const roots = ["src/aot/", ...foldersOfLoad];

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
      expect(path).toMatch(/\.rs$/);
      const source = lines.join("\n");
      const found = findInSource(path, source).map(({ line, pattern }) => ({ line, pattern }));
      if (verdict === "finds") {
        const here = lines.findIndex(text => /\/\/ here\s*$/.test(text));
        expect(found).toEqual([{ line: here < 0 ? expect.any(Number) : here + 1, pattern: note }]);
      } else {
        expect(source).toMatch(/\S/);
        expect(found).toEqual([]);
        if (lines.some(text => reasonToAllow(path, text.trim()) !== undefined))
          expect(findInSource(ordinaryPath, source)).not.toEqual([]);
      }
    });
  }

  test("has a red line for each pattern", () => {
    const marked = red.map(({ note }) => note);
    expect(patternsWithRedLine.filter(pattern => !marked.includes(pattern))).toEqual([]);
  });

  test("has a green line for each entry of `allowed`", () => {
    const withoutGreenLine = allowed.filter(
      ({ paths, lines: allowedLines }) =>
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
  // What lies in src/aot/ has one folder, and each folder of `load` has its own, as in a checkout.
  test("is found again in the files of a folder", () => {
    using folder = tempDir(
      "names-compared-as-text",
      Object.fromEntries(
        snippets.map(({ verdict, path, lines }, index) => {
          const root = roots.find(root => path.startsWith(root))!;
          const name = verdict === "finds" ? `red-${index}.rs` : path.slice(root.length);
          return [(foldersOfLoad.includes(root) ? root : "trees/") + name, lines.join("\n")];
        }),
      ),
    );
    const load = Object.fromEntries(foldersOfLoad.map(root => [root, join(String(folder), root)]));
    const found = findNamesComparedAsText({ frontEnd: join(String(folder), "trees"), load });
    expect(found.map(({ pattern }) => pattern).sort()).toEqual(red.map(({ note }) => note).sort());
  });
});

test("no name is compared as text in the front end's Rust", () => {
  const read = pathsRead(rootsOfThisCheckout);
  expect(roots.filter(root => !read.some(path => path.startsWith(root)))).toEqual([]);
  expect(findNamesComparedAsText(rootsOfThisCheckout).map(String)).toEqual([]);
}, 600_000);
