// Writes the inputs for the path ground truth: every unit name, config value and directive path of the corpus, plus synthetic shapes.
import { enumerateFiles } from "./compiler_runner";
import { extractCompilerSettings, parseTestFilesAndSymlinks } from "./test_case_parser";
import { readFile } from "./vfs";
const root = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const names = new Set<string>();
const dirs = new Set<string>(["/.src", "", "/", "c:/root", "/a/b"]);
for (const f of [...enumerateFiles(root + "/compiler", true), ...enumerateFiles(root + "/conformance", true)]) {
  const text = readFile(f).contents;
  const p = parseTestFilesAndSymlinks(text, f, (name, content) => ({ value: { name, content }, error: undefined }));
  if (!p.ok) continue;
  for (const u of p.units) names.add(u.name);
  for (const [a, b] of p.symlinks) { names.add(a); names.add(b); }
  if (p.currentDirectory !== "") dirs.add(p.currentDirectory);
  const s = extractCompilerSettings(text);
  for (const k of ["baseurl", "outfile", "outdir", "rootdir", "currentdirectory"]) if (s.has(k)) names.add(s.get(k)!);
  for (const m of text.matchAll(/"(?:baseUrl|outFile|extends)"\s*:\s*"([^"\n]*)"/g)) names.add(m[1]);
}
const parts = ["", ".", "..", "a", "a.b", "..a", "a..", "...", "c:", "C:\\", "c:/", "//", "//server", "//server/share", "\\\\s\\x", "^/", "file:///", "file:///c:/x", "http://h/p", "${configDir}", "a b"];
const synth = new Set<string>();
for (const a of parts) for (const b of parts) for (const sep of ["/", "//", "\\", "/./", "/../"]) {
  synth.add(a + sep + b);
  synth.add(sep + a + sep + b);
  synth.add(a + sep + b + sep);
}
for (const a of parts) synth.add(a);
const all = [...new Set([...names, ...synth])].filter(x => !/[\t\n\r]/.test(x)).sort();
const out: string[] = [];
for (const d of [...dirs].filter(x => !/[\t\n\r]/.test(x)).sort()) for (const n of all) out.push(n + "\t" + d);
await Bun.write(process.argv[2], out.join("\n") + "\n");
console.log("names from the corpus", names.size, "synthetic", synth.size, "directories", dirs.size, "pairs", out.length);
