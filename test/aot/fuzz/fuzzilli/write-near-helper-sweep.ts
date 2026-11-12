// Helpers that are nearly the published ones: each stored program of one file that defines a helper of tsc, esbuild or Babel, written again with one token of the definition changed.
//
//   bun write-near-helper-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<program>--line-<l>-at-<c>-<what stands there now>.<extension>
//   bun write-near-helper-sweep.ts count
//   bun write-near-helper-sweep.ts named <pattern> <folder> [most]
//
// The compiler knows those helpers by their text and does in their place what they are known to do. `bun <file>` runs a changed helper as it is written. A compiler that still takes it for the published one parts from that.
// The programs come out of ../../parallel, so the count moves with the tree. The first of each program is the program as it is.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const names =
  /\b(__defProp|__defNormalProp|__publicField|__export|__copyProps|__toESM|__toCommonJS|__commonJS|__esm|__reExport|__createBinding|__exportStar|__importStar|__importDefault|__setModuleDefault|_defineProperties|_createClass|_toPropertyKey|_toPrimitive|_typeof|_defineProperty|__classPrivateField\w+|__require|__markAsModule)\b/;
const defines = new RegExp(`^\\s*(?:var|let|const|function)\\s+${names.source}`);
const dependsOnWhereItLies = /from "\.|require\("\.|import\("\.|import\.meta|__dirname|__filename/;

const changes: [found: RegExp, into: string][] = [
  [/\btrue\b/g, "false"],
  [/\bfalse\b/g, "true"],
  [/!0\b/g, "!1"],
  [/!1\b/g, "!0"],
  [/ === /g, " !== "],
  [/ !== /g, " === "],
  [/ == /g, " != "],
  [/ != /g, " == "],
  [/ && /g, " || "],
  [/ \|\| /g, " && "],
  [/ \|\| /g, " ?? "],
  [/ in /g, " == "],
  [/"default"/g, '"defaulted"'],
  [/"__esModule"/g, '"__esmodule"'],
  [/"symbol"/g, '"string"'],
  [/"object"/g, '"function"'],
  [/"function"/g, '"object"'],
  [/\benumerable\b/g, "configurable"],
  [/\bconfigurable\b/g, "enumerable"],
  [/\bwritable\b/g, "enumerable"],
  [/\bget:/g, "value:"],
  [/(?<=[{,] )value(?= \})/g, "value: undefined"],
  [/ \+ ""/g, ""],
  [/\bgetOwnPropertyNames\b/g, "keys"],
  [/\bhasOwnProperty\b/g, "propertyIsEnumerable"],
  [/\bvoid 0\b/g, "null"],
  [/\bundefined\b/g, "null"],
  [/\bnull\b/g, "undefined"],
  [/\bthis\b/g, "globalThis"],
];

const inWords: Record<string, string> = { "&&": "and", "||": "or", "??": "nullish", "===": "is", "!==": "is-not", "==": "equals", "!=": "differs", "!0": "not-0", "!1": "not-1" }; // prettier-ignore

function storedPrograms(root: string) {
  const found: string[] = [];
  const visit = (folder: string) => {
    const entries = readdirSync(folder, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return;
    for (const entry of entries)
      if (entry.isDirectory()) visit(join(folder, entry.name));
      else if (/\.[cm]?[jt]s$/.test(entry.name) && !entry.name.endsWith(".d.ts")) found.push(join(folder, entry.name));
  };
  visit(root);
  return found.sort();
}

const programs: { name: string; text: string }[] = [];
for (const file of storedPrograms(join(import.meta.dir, "..", "..", "parallel"))) {
  if (statSync(file).size > 40_000) continue;
  const text = readFileSync(file, "utf8");
  if (!names.test(text) || dependsOnWhereItLies.test(text)) continue;
  const lines = text.split("\n");
  const [extension, stem] = [extname(file), basename(file, extname(file))];
  const changed: typeof programs = [];
  lines.forEach((line, at) => {
    if (!defines.test(line)) return;
    for (const [found, into] of changes)
      for (const { 0: token, index } of line.matchAll(found))
        changed.push({
          name: `${stem}--line-${at + 1}-at-${index}-${inWords[into.trim()] ?? (into.trim().replace(/\W+/g, "_") || "nothing")}${extension}`,
          text: [...lines.slice(0, at), line.slice(0, index) + into + line.slice(index + token.length), ...lines.slice(at + 1)].join("\n"), // prettier-ignore
        });
  });
  if (changed.length) programs.push({ name: `${stem}--as-it-is${extension}`, text }, ...changed);
}

const all = programs.length;
const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    if (!pattern.test(programs[at].name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${programs[at].name}`, programs[at].text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    writeFileSync(`${folder}/${pad(at)}-${programs[at].name}`, programs[at].text);
  }
  console.log(Math.min(count, all));
}
