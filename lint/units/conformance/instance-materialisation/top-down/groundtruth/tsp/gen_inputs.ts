// Inputs for the path vectors: every unit name, link and current directory of the corpus, and a fixed set of hard shapes.
import { readFileSync, writeFileSync } from "node:fs";
import { enumerateFiles } from "../../../../enumerator/prototype/compiler_runner";
import { parseTestFilesAndSymlinks } from "../../../../enumerator/prototype/test_case_parser";
import { readFile } from "../../../../enumerator/prototype/vfs";
const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const pairs = new Set<string>();
const add = (name: string, dir: string) => pairs.add(JSON.stringify([name, dir]));
for (const suite of ["compiler", "conformance"]) {
  for (const f of enumerateFiles(casesRoot + "/" + suite, true)) {
    const text = readFile(f).contents;
    const p = parseTestFilesAndSymlinks(text, f, (name, content) => ({ value: { name, content }, error: undefined }));
    if (!p.ok) continue;
    const dir = p.currentDirectory === "" ? "/.src" : p.currentDirectory;
    for (const u of p.units) add(u.name, dir);
    for (const [l, t] of p.symlinks) { add(l, dir); add(t, dir); }
  }
}
const corpus = pairs.size;
const names = [
  "", ".", "..", "/", "//", "///", "\\", "\\\\", "a", "a/", "a//", "a/b", "a\\b", "a/b/", "./a", "./a/", "../a", "../../a", "a/..", "a/../", "a/../..", "a/../../b", "a/./b", "a//b", "a/b/../c", "a/b/../../c", "a/b/../../../c",
  "/a", "/a/", "/a/b", "/a/..", "/a/../..", "/..", "/../a", "/./a", "/a/./b/../c", "/a//b", "/.src/a.ts", "/.src/../a.ts", "/.src/./a.ts", "/.lib/react.d.ts", "/a/b/c.d.ts", "/a/b.c/d", "/a/b.c/", "/a/.hidden", "/a/file.", "/a/.ts", "/.ts", ".ts", "a.d.ts", ".d.ts", "x.json", ".json", "x.tsbuildinfo", "x.TS", "x.D.TS", "x.d.mts", "x.d.cts", "x.mjs", "x.min.js", "x.test.tsx",
  "c:", "c:/", "c:\\", "c:a", "c:/a", "c:\\a\\b", "C:/a/../b", "c:/..", "c:/a/./b/", "C:/A/b.ts", "c:/a\\b/c", "1:/a", "cc:/a", "c:/a/..\\..\\b",
  "//server", "//server/", "//server/share", "//server/share/a/../b", "\\\\server\\share\\a", "/\\server", "\\/server/a",
  "file:///a/b", "file:///c:/a", "file://server/a", "file:///c%3A/a", "http://host/a/../b", "bundled:///libs/lib.d.ts", "^/untitled/ts-nul-authority/Untitled-1", "^/a/../b", "^",
  "a b/c d.ts", "é/ü.ts", "İ/I.ts", "ǅ.ts", "K.ts", "ẞ.ts", "Σ.ts", "😀/a.ts", "a\tb", "${configDir}/a", "A/B/C.TS", "tsconfig.json", "/a/TSCONFIG.JSON", "jsconfig.json", "a/tsconfig.base.json",
  "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z.ts", "a/../b/../c/../d", "./././a", "a/././.", "a/.../b", "a/..b", "a/b..", "..a", "a.", "a..", ".../a", "a/ /b", " a", "a ",
];
const dirs = ["", "/", "/.src", "/.src/", "/a/b", "/a/b/", "c:/root", "c:\\root", "C:/", "//server/share", "rel/dir", "/.src/test", "/a/../b", "."];
for (const n of names) for (const d of dirs) add(n, d);
writeFileSync("inputs.jsonl", [...pairs].join("\n") + "\n");
console.log("pairs", pairs.size, "from the corpus", corpus);
