// Research probe: vectors for the ground truth program (paths, file matching), from the corpus and synthetic.
import { getConfigFileNames, Undecided } from "./config_files";
import { enumerateFiles } from "./enum_runner";
import { MemFs, MemFsPanic, type MemInput } from "./memfs";
import { readFile } from "./readfile";
import { getConfigNameFromFileName, parseTestFilesAndSymlinks } from "./test_case_parser";
import { getDirectoryPath, getNormalizedAbsolutePath } from "./tspath";

const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const files = [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)];
const enc = new TextEncoder();

const pathPairs = new Map<string, { a: string; b: string }>();
const addPair = (a: string, b: string) => pathPairs.set(a + "\u0000" + b, { a, b });
const match: any[] = [];

for (const f of files) {
  const r = readFile(f);
  const p = parseTestFilesAndSymlinks(r.contents, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!p.ok) continue;
  const raw = p.currentDirectory;
  const cd = raw === "" ? "/.src" : raw;
  const abs = getNormalizedAbsolutePath(raw, "/.src");
  for (const u of p.units) {
    addPair(u.name, cd);
    addPair(u.name, abs);
    addPair(getNormalizedAbsolutePath(u.name, abs), abs);
  }
  for (const [link, target] of p.symlinks) {
    addPair(link, abs);
    addPair(target, abs);
  }
  if (raw !== "") addPair(raw, "/.src");
  for (const k of ["outdir", "rootdir", "baseurl", "declarationdir", "outfile", "typeroots", "rootdirs", "project", "tsbuildinfofile", "mapRoot", "sourceroot"]) {
    const v = p.globalOptions.get(k);
    if (v !== undefined) for (const part of v.split(",")) addPair(part, abs);
  }
  const cfg = p.units.find(u => getConfigNameFromFileName(u.name) !== "");
  if (cfg === undefined) continue;
  const entries = new Map<string, MemInput>();
  for (const u of p.units) entries.set(getNormalizedAbsolutePath(u.name, cd), { kind: "file", data: enc.encode(u.content) });
  const symlinks: Record<string, string> = {};
  for (const [link, target] of p.symlinks) {
    const l = getNormalizedAbsolutePath(link, cd);
    const t = getNormalizedAbsolutePath(target, cd);
    entries.set(l, { kind: "symlink", target: t });
    symlinks[l] = t;
  }
  let host: MemFs;
  try {
    host = new MemFs(entries, true);
  } catch (e) {
    if (e instanceof MemFsPanic) continue;
    throw e;
  }
  try {
    const got = getConfigFileNames(host, cfg.name, cfg.content, cd);
    const o = got.options;
    const allowJs = o !== undefined && (o.allowJs !== 0 ? o.allowJs === 2 : o.checkJs === 2);
    // the flag of the reference, from the same getters
    const json = (got as any).resolveJson ?? undefined;
    match.push({
      name: "corpus:" + f.slice(root.length + 1),
      files: [...entries].filter(([, e]) => e.kind === "file").map(([k]) => k),
      symlinks,
      ucsfn: true,
      basePath: got.basePathForFileNames,
      fileSpec: got.specs.validatedFilesSpec,
      includes: got.specs.validatedIncludeSpecs,
      excludes: got.specs.validatedExcludeSpecs,
      allowJs,
      json: json ?? resolveJson(o),
    });
    for (const s of [...got.specs.validatedIncludeSpecs, ...got.specs.validatedExcludeSpecs, ...got.specs.validatedFilesSpec]) addPair(s, got.basePathForFileNames);
    addPair(getDirectoryPath(getNormalizedAbsolutePath(cfg.name, cd)), cd);
  } catch (e) {
    if (!(e instanceof Undecided)) throw e;
  }
}

function resolveJson(o: any): boolean {
  if (o === undefined) return true;
  if (o.resolveJsonModule !== 0) return o.resolveJsonModule === 2;
  const target = o.target !== 0 ? o.target : 12;
  const m = o.module !== 0 ? o.module : target === 99 ? 99 : target >= 9 ? 7 : target >= 7 ? 6 : target >= 2 ? 5 : 1;
  if (m === 102 || m === 199) return true;
  if (o.moduleResolution > 2) return o.moduleResolution === 100;
  return !(m === 100 || m === 101 || m === 102 || m === 199);
}

// synthetic paths
const atoms = [
  "", ".", "..", "/", "//", "\\", "a", "a/", "a/b", "a\\b", "a//b", "a/./b", "a/../b", "../a", "../../a", "./a", "./", "../", "a/..", "a/.", "a/b/..", "a/b/../..", "a/b/../../..",
  "/a", "/a/", "/a/b.ts", "/a/../b", "/../a", "/..", "/.", "/./a", "/a//b", "/a/b/", "/a/b//", "/.src", "/.src/a.ts", "/.src/../a.ts", "/.src/./a.ts", "/.lib/react.d.ts", "/.ts/x",
  "c:", "c:/", "c:\\", "c:a", "c:/a", "c:\\a\\b.ts", "C:/A/b.ts", "c:/a/../b", "c:/..", "C:\\a\\..\\..\\b", "d:/a", "c:/a/b/", "c:/a\\b/c",
  "//server", "//server/", "//server/share", "//server/share/a.ts", "\\\\server\\share\\a.ts", "//server/../a",
  "file:///a/b", "file:///c:/a", "file://server/a", "file:///c%3a/a", "http://x/y/../z", "^/untitled/ts-nul-authority/Untitled-1", "^/a/../b",
  "a.ts", "a.d.ts", "a.tsx", "a.js", "a.jsx", "a.mts", "a.d.mts", "a.cts", "a.d.cts", "a.mjs", "a.cjs", "a.json", "a.tsbuildinfo", "a.d.json.ts", "a.min.js", ".ts", ".d.ts", "a.TS", "a.D.TS", "a.b.c", "a.", ".a", "..a", "a..b",
  "dir.ext/file", "dir.ext/", "/a/b.c/d", "A/B", "a/b", "\u00e9/\u00c9", "\u0130", "I\u0307", "\u212a", "k", "K", "\u00df", "\u1e9e", "\u{1f600}/a", "a/\u{10400}", "a/\u{10428}",
  "node_modules", "NODE_MODULES/x", "/a/node_modules/b", "tsconfig.json", "/tsconfig.json", "TSCONFIG.JSON", "jsconfig.json", "/a/b/tsconfig.json/", "x/tsconfig.json5",
];
for (const a of atoms) for (const b of ["", "/", "/.src", "/a/b", "c:/", "c:/x", "rel", "../rel", "//server/share", "C:\\Y", "/A/B", "/a/b/"]) addPair(a, b);
for (const a of atoms) for (const b of atoms.slice(0, 60)) if ((a.length * 7 + b.length * 13) % 5 === 0) addPair(a, b);

// synthetic matching
const trees: Record<string, { files: string[]; symlinks?: Record<string, string> }> = {
  plain: {
    files: [
      "/p/tsconfig.json", "/p/a.ts", "/p/a.d.ts", "/p/a.js", "/p/b.tsx", "/p/b.ts", "/p/c.d.ts", "/p/c.js", "/p/d.js", "/p/d.jsx", "/p/e.mts", "/p/e.d.mts", "/p/e.mjs", "/p/f.cts", "/p/f.cjs", "/p/g.json", "/p/h.min.js", "/p/i.d.ts", "/p/i.tsx",
      "/p/.hidden.ts", "/p/.dir/x.ts", "/p/src/x.ts", "/p/src/y.test.ts", "/p/src/deep/z.ts", "/p/src/deep/.git/w.ts", "/p/src/node_modules/m/index.ts", "/p/src/Node_Modules/m/index.ts", "/p/node_modules/n/index.d.ts", "/p/bower_components/q.ts", "/p/jspm_packages/r.ts",
      "/p/out/o.ts", "/p/out/o.d.ts", "/p/types/t.d.ts", "/p/test/u.ts", "/p/test/data.json", "/p/a b/sp ace.ts", "/p/\u00e9/\u00fc.ts", "/p/x.ts.txt", "/p/noext", "/p/dir.with.dots/v.ts", "/q/outside.ts", "/p/SRC2/Upper.TS", "/p/src2/lower.ts",
      "/p/src/a.min.js", "/p/src/b.MIN.JS", "/p/src/jquery.min.d.ts",
    ],
  },
  windows: { files: ["c:/root/tsconfig.json", "c:/root/a.ts", "c:/root/src/b.ts", "c:/root/node_modules/x/index.d.ts", "c:/other/c.ts", "c:/root/out/d.ts"] },
  links: {
    files: ["/m/tsconfig.json", "/m/main.ts", "/m/lib/real.ts", "/m/lib/sub/deep.ts", "/other/pkg/index.ts", "/other/pkg/inner/i.ts"],
    symlinks: { "/m/linked": "/other/pkg", "/m/lib/loop": "/m/lib", "/m/file-link.ts": "/m/lib/real.ts", "/m/broken": "/nowhere/x", "/other/pkg/back": "/m" },
  },
  rootcfg: { files: ["/tsconfig.json", "/a.ts", "/src/b.ts", "/node_modules/@types/x/index.d.ts", "/.src/c.ts", "/dist/d.ts", "/types/e.d.ts"] },
};
const specSets: { fileSpec?: string[]; includes: string[]; excludes: string[] }[] = [
  { includes: ["**/*"], excludes: [] },
  { includes: ["**/*"], excludes: ["/p/out"] },
  { includes: ["**/*"], excludes: ["/p/out", "/p/types"] },
  { includes: ["**/*"], excludes: ["out", "types"] },
  { includes: ["**/*"], excludes: ["**/deep"] },
  { includes: ["**/*"], excludes: ["**/*.test.ts"] },
  { includes: ["**/*"], excludes: ["src/**/*"] },
  { includes: ["**/*"], excludes: ["**/node_modules"] },
  { includes: ["src"], excludes: [] },
  { includes: ["src", "test"], excludes: [] },
  { includes: ["test", "src"], excludes: [] },
  { includes: ["src/"], excludes: [] },
  { includes: ["./src"], excludes: [] },
  { includes: ["src/**/*"], excludes: [] },
  { includes: ["src/*"], excludes: [] },
  { includes: ["src/*.ts"], excludes: [] },
  { includes: ["src/**/*.ts"], excludes: [] },
  { includes: ["*.ts"], excludes: [] },
  { includes: ["*"], excludes: [] },
  { includes: ["?.ts"], excludes: [] },
  { includes: ["a.ts"], excludes: [] },
  { includes: ["index.ts"], excludes: [] },
  { includes: ["a.*"], excludes: [] },
  { includes: ["**/*.json"], excludes: [] },
  { includes: ["test/*.json", "src"], excludes: [] },
  { includes: ["**/*.min.js"], excludes: [] },
  { includes: ["src/*.min.*"], excludes: [] },
  { includes: ["**/.hidden.ts", ".dir"], excludes: [] },
  { includes: [".dir/**/*"], excludes: [] },
  { includes: ["node_modules"], excludes: [] },
  { includes: ["node_modules/**/*"], excludes: [] },
  { includes: ["src/node_modules/**/*"], excludes: [] },
  { includes: ["**/node_modules/**/*"], excludes: [] },
  { includes: ["../q"], excludes: [] },
  { includes: ["../q/*.ts", "src"], excludes: [] },
  { includes: ["/q/**/*"], excludes: [] },
  { includes: ["src\\**\\*"], excludes: [] },
  { includes: ["src/../test"], excludes: [] },
  { includes: ["a b", "\u00e9"], excludes: [] },
  { includes: ["dir.with.dots"], excludes: [] },
  { includes: ["dir.with.dots/**/*"], excludes: [] },
  { includes: ["SRC2"], excludes: [] },
  { includes: ["src2/**/*"], excludes: ["**/Upper.*"] },
  { includes: ["linked"], excludes: [] },
  { includes: ["**/*"], excludes: ["linked"] },
  { includes: ["lib/**/*"], excludes: [] },
  { includes: ["**/*"], excludes: ["c:/root/out"] },
  { fileSpec: ["a.ts"], includes: [], excludes: [] },
  { fileSpec: ["a.ts", "src/x.ts", "missing.ts", "/q/outside.ts", "A.ts"], includes: [], excludes: [] },
  { fileSpec: ["a.d.ts"], includes: ["**/*"], excludes: [] },
  { fileSpec: ["/p/a.ts"], includes: ["**/*"], excludes: [] },
  { fileSpec: ["src/x.ts"], includes: ["src"], excludes: ["src"] },
  { includes: ["**/*", "src"], excludes: [] },
  { includes: ["src/deep", "**/*"], excludes: [] },
];
trees.plainci = { files: trees.plain.files.filter(f => f !== "/p/src/Node_Modules/m/index.ts").concat(["/p/Src3/Mixed.Ts", "/p/NODE_MODULES2/x.ts", "/p/Bower_Components/y.ts"]) };
for (const [treeName, tree] of Object.entries(trees)) {
  const base = treeName === "windows" ? "c:/root" : treeName === "links" ? "/m" : treeName === "rootcfg" ? "/" : "/p";
  let n = 0;
  for (const s of specSets) {
    for (const ucsfn of [true, false]) {
      for (const [allowJs, json] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        match.push({
          name: `synthetic:${treeName}:${n}:${ucsfn ? "cs" : "ci"}:${allowJs ? "js" : "ts"}:${json ? "json" : "nojson"}`,
          files: tree.files,
          symlinks: tree.symlinks ?? {},
          ucsfn,
          basePath: base,
          fileSpec: s.fileSpec ?? [],
          includes: s.includes,
          excludes: s.excludes,
          allowJs,
          json,
        });
      }
    }
    n++;
  }
}

await Bun.write(process.argv[2], JSON.stringify({ paths: [...pathPairs.values()], match }));
console.log("paths", pathPairs.size, "match", match.length);
