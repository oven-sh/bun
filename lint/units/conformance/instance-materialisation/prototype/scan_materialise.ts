// Research probe: which instances cannot be materialised faithfully, by cause, with counts of cases and of run instances.
import { buildHarnessFs, newCompilerTest } from "./compiler_test";
import { enumerateInstances } from "./enum_runner";
import { readFile } from "./readfile";
import { getRootLength } from "./tspath";

const casesRoot = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases";
const e = enumerateInstances({ casesRoot });
const cache = new Map<string, string>();

type Cause = string;
const runByCause = new Map<Cause, Set<string>>();
const allByCause = new Map<Cause, Set<string>>();
const casesByCause = new Map<Cause, Set<string>>();
const examples = new Map<Cause, string[]>();
function hit(cause: Cause, inst: { name: string; suite: string; casePath: string; status: string }, detail: string) {
  const id = inst.suite + "/" + inst.name;
  if (!allByCause.has(cause)) {
    allByCause.set(cause, new Set());
    runByCause.set(cause, new Set());
    casesByCause.set(cause, new Set());
    examples.set(cause, []);
  }
  allByCause.get(cause)!.add(id);
  if (inst.status === "run") runByCause.get(cause)!.add(id);
  const cs = casesByCause.get(cause)!;
  if (!cs.has(inst.casePath)) {
    cs.add(inst.casePath);
    const ex = examples.get(cause)!;
    if (ex.length < 400) ex.push(inst.casePath + "\t" + detail);
  }
}

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const pathOptions = ["outdir", "rootdir", "baseurl", "declarationdir", "outfile", "typeroots", "rootdirs", "project", "tsbuildinfofile", "maproot", "sourceroot", "paths", "generatecpuprofile", "generatetrace"];
let maxLen = 0;
let maxLenName = "";
const lens: number[] = [];
let total = 0;
let totalRun = 0;
const statusCount: Record<string, number> = {};

for (const inst of e.instances) {
  total++;
  const file = casesRoot + "/" + inst.casePath;
  let content = cache.get(file);
  if (content === undefined) {
    content = readFile(file).contents;
    cache.set(file, content);
  }
  const config = inst.config === undefined ? undefined : new Map(inst.config);
  const r = newCompilerTest(content, file, config);
  if (!r.ok) {
    statusCount[inst.status + "/" + r.status] = (statusCount[inst.status + "/" + r.status] ?? 0) + 1;
    hit("roots " + r.status, inst, r.reason);
    continue;
  }
  if (inst.status === "run") totalRun++;
  const t = r.value;
  const ucsfnRaw = (config?.get("usecasesensitivefilenames") ?? "true").toLowerCase();
  const ucsfn = ucsfnRaw !== "false";
  const fsx = buildHarnessFs(t, { libFiles: (config?.get("libfiles") ?? "").split(",").filter(s => s !== ""), noLib: (config?.get("nolib") ?? "").toLowerCase() === "true", useCaseSensitiveFileNames: ucsfn });
  const names = [...fsx.entries.keys()];
  const all = [...names, t.currentDirectory, ...t.tsConfigFiles.map(f => f.unitName)];

  if (t.rule === "config") hit("has a config unit", inst, t.tsConfigFiles[0].unitName);
  if (fsx.includeLibDir) hit("mounts /.lib", inst, "");
  if ([...fsx.entries.values()].some(x => x.kind === "symlink")) hit("has links", inst, [...fsx.entries].filter(([, x]) => x.kind === "symlink").map(([k, x]) => k + " -> " + (x as any).target).join(", "));
  if (!ucsfn) hit("virtual file system is case insensitive", inst, "");

  // A: names with a DOS root
  const dos = all.filter(n => /^[a-zA-Z]:/.test(n));
  if (dos.length > 0) hit("name with a drive root", inst, dos[0]);
  const notRooted = all.filter(n => getRootLength(n) === 0);
  if (notRooted.length > 0) hit("name that is not rooted", inst, notRooted[0]);
  const dosOpt: string[] = [];
  const absOpt: string[] = [];
  for (const k of pathOptions) {
    const v = config?.get(k);
    if (v === undefined) continue;
    for (const part of v.split(",")) {
      const p = part.trim();
      if (/^[a-zA-Z]:/.test(p)) dosOpt.push(k + "=" + p);
      else if (p.startsWith("/") || p.startsWith("\\")) absOpt.push(k + "=" + p);
    }
  }
  if (dosOpt.length > 0) hit("option value with a drive root", inst, dosOpt.join(" "));
  if (absOpt.length > 0) hit("option value that is an absolute path (the check function maps it)", inst, absOpt.join(" "));

  // B: absolute references inside unit text
  const firstComponents = new Set<string>([".lib", ".ts", ".src"]);
  for (const n of names) {
    if (n.startsWith("/")) {
      const c = n.slice(1).split("/")[0];
      if (c !== "") firstComponents.add(c);
    }
  }
  const units = [...t.toBeCompiled, ...t.otherFiles, ...t.tsConfigFiles];
  let narrow = "";
  let broad = "";
  let drive = "";
  let inRoots = false;
  for (const u of units) {
    const isConfig = t.tsConfigFiles.includes(u);
    for (const m of u.content.matchAll(/["'`]((?:\/|[a-zA-Z]:[\\/])[^"'`\s]*)/g)) {
      const s = m[1];
      if (/^[a-zA-Z]:[\\/]/.test(s)) {
        if (drive === "") drive = s;
        continue;
      }
      if (s.startsWith("//") || s === "/" ) continue;
      if (s.startsWith("/>") || s.startsWith("/*") ) continue;
      const first = s.slice(1).split("/")[0];
      if (broad === "") broad = s;
      if (firstComponents.has(first)) {
        if (narrow === "") narrow = (isConfig ? "(config) " : "") + s;
        if (t.toBeCompiled.includes(u)) inRoots = true;
      }
    }
  }
  if (narrow !== "") hit("text names an absolute path of the instance", inst, narrow);
  if (narrow !== "" && /^\/\.lib\//.test(narrow)) hit("text names /.lib/", inst, narrow);
  if (broad !== "" && narrow === "") hit("text has a quoted string that starts with a slash, no file of the instance below its first name", inst, broad);
  if (drive !== "") hit("text names a path with a drive root", inst, drive);

  // D: names that differ only in case, as files or as directories
  const comps = new Map<string, Set<string>>();
  for (const n of names) {
    const parts = n.split("/");
    let prefix = "";
    for (const p of parts) {
      const key = (prefix + "/" + p).toLowerCase();
      if (!comps.has(key)) comps.set(key, new Set());
      comps.get(key)!.add(prefix + "/" + p);
      prefix = prefix + "/" + p;
    }
  }
  const clash = [...comps.values()].find(s => s.size > 1);
  if (clash !== undefined) hit("names that differ only in case", inst, [...clash].join(" | "));

  // E: names that Windows rejects
  const badChar: string[] = [];
  const badEnd: string[] = [];
  const device: string[] = [];
  for (const n of all) {
    const rest = n.replace(/^[a-zA-Z]:/, "");
    for (const p of rest.split("/")) {
      if (p === "") continue;
      if (/[<>:"|?*\u0000-\u001f\\]/.test(p)) badChar.push(n);
      if (/[. ]$/.test(p) && p !== "." && p !== "..") badEnd.push(n);
      if (reserved.test(p)) device.push(n);
    }
  }
  if (badChar.length > 0) hit("name with a character that Windows rejects", inst, badChar[0]);
  if (badEnd.length > 0) hit("name that ends in a dot or a space", inst, JSON.stringify(badEnd[0]));
  if (device.length > 0) hit("name of a Windows device", inst, device[0]);

  // H: a file that is also a directory of another file
  const set = new Set(names);
  const both = names.find(n => {
    let d = n;
    for (;;) {
      const i = d.lastIndexOf("/");
      if (i <= 0) return false;
      d = d.slice(0, i);
      if (set.has(d) && fsx.entries.get(d)!.kind === "file") return true;
    }
  });
  if (both !== undefined) hit("a file is also the directory of another file", inst, both);

  // duplicates of one name
  const seen = new Set<string>();
  const dup = [...t.toBeCompiled, ...t.otherFiles].map(f => f.unitName).find(n => (seen.has(n) ? true : (seen.add(n), false)));
  if (dup !== undefined) hit("two units have one name (the later write wins)", inst, dup);
  const linkOverFile = [...t.symlinks.keys()].length > 0 && [...t.toBeCompiled, ...t.otherFiles].some(f => fsx.entries.get(f.unitName)?.kind === "symlink");
  if (linkOverFile) hit("a link replaces a unit of the same name", inst, "");

  // G: length
  for (const n of names) {
    lens.push(n.length);
    if (n.length > maxLen) {
      maxLen = n.length;
      maxLenName = inst.casePath + " " + n;
    }
    const bytes = Buffer.byteLength(n.split("/").reduce((a, b) => (Buffer.byteLength(a) > Buffer.byteLength(b) ? a : b)), "utf8");
    if (bytes > 255) hit("name component longer than 255 bytes", inst, n);
  }
  if (names.some(n => n.length > 150)) hit("virtual path longer than 150", inst, names.find(n => n.length > 150)!);
  if (names.some(n => /[^\u0000-\u007f]/.test(n))) hit("name with a character outside ASCII", inst, names.find(n => /[^\u0000-\u007f]/.test(n))!);
  if (names.some(n => / /.test(n))) hit("name with a space", inst, names.find(n => / /.test(n))!);

  // the current directory holds no file
  const cd = t.currentDirectory;
  if (!names.some(n => n.startsWith(cd === "/" ? "/" : cd + "/"))) hit("no file below the current directory", inst, cd);
  if (fsx.programFileNames.length === 0) hit("no program file among the roots", inst, t.toBeCompiled.map(f => f.unitName).join(","));
  if (t.toBeCompiled.some(f => /\.(json|tsbuildinfo)$/.test(f.unitName))) hit("a root is a JSON or tsbuildinfo file", inst, t.toBeCompiled.map(f => f.unitName).filter(n => /\.(json|tsbuildinfo)$/.test(n)).join(","));
  const inLibOrSrc = names.filter(n => n.startsWith("/.lib/") || n.startsWith("/.ts/"));
  if (inLibOrSrc.length > 0) hit("a unit lies below /.lib or /.ts", inst, inLibOrSrc[0]);
}

console.log(JSON.stringify({ total, totalRunDecided: totalRun, statusCount, maxLen, maxLenName }));
const rows = [...allByCause.keys()].sort();
console.log("cause\tcases\tinstances\trun instances");
for (const k of rows) console.log([k, casesByCause.get(k)!.size, allByCause.get(k)!.size, runByCause.get(k)!.size].join("\t"));
const want = process.argv[2];
if (want) {
  for (const k of rows) {
    if (!want.split("|").some(w => k.includes(w))) continue;
    console.log("== " + k);
    for (const x of examples.get(k)!) console.log("  " + x.slice(0, 300));
  }
}
// union of the causes that make a materialised run unfaithful on every platform
const union = (keys: string[], onlyRun: boolean) => {
  const s = new Set<string>();
  for (const k of keys) for (const id of (onlyRun ? runByCause : allByCause).get(k) ?? []) s.add(id);
  return s.size;
};
const everywhere = ["name with a drive root", "option value with a drive root", "text names an absolute path of the instance", "text names a path with a drive root", "name that is not rooted"];
console.log("union on every platform: instances", union(everywhere, false), "run", union(everywhere, true));
const caseInsensitiveDisk = [...everywhere, "names that differ only in case"];
console.log("union on a disk that ignores case: instances", union(caseInsensitiveDisk, false), "run", union(caseInsensitiveDisk, true));
const caseSensitiveDisk = [...everywhere, "virtual file system is case insensitive"];
console.log("union on a disk that respects case: instances", union(caseSensitiveDisk, false), "run", union(caseSensitiveDisk, true));
const windows = [...caseInsensitiveDisk, "name with a character that Windows rejects", "name that ends in a dot or a space", "name of a Windows device"];
console.log("union on Windows with links: instances", union(windows, false), "run", union(windows, true));
console.log("union on Windows without links: instances", union([...windows, "has links"], false), "run", union([...windows, "has links"], true));
