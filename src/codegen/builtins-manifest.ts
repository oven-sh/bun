import fs from "node:fs";
import path from "node:path";
import { constants, zstdCompressSync, type ZstdOptions } from "node:zlib";
import base from "../../tsconfig.base.json";
import own from "../js/tsconfig.json";
import "./builtin-parser";
import {
  type EngineFunctions,
  functionFiles,
  functionIds,
  helperModules,
  locate,
  moduleList,
  nativeStartIndex,
  sourceFiles,
  specifierOf,
} from "./builtins-manifest-model";
import { encodeNumbers, moveBundledNamesToSecondText } from "./bundled-positions";
import { writeIfNotChanged, writeIfNotChangedBinary } from "./helpers";
import { rangesSeenByEveryFile } from "./part-seen-by-every-file";
import { define, globalsToPrefix } from "./replacements";

const output = process.argv[3];
const archive = process.argv[4]?.startsWith("--") ? undefined : process.argv[4];
const flagValue = (flag: string) =>
  process.argv
    .slice(4)
    .find(argument => argument.startsWith(flag))
    ?.slice(flag.length);
const engineFunctions = flagValue("--engine-functions=");
const bundledNamesOfModules = flagValue("--bundled-names-of-modules=");
const bundledHelpers = flagValue("--bundled-helpers=");
const evaluatedModules = flagValue("--evaluated-modules=");
if (
  !/^--debug=(OFF|ON)$/.test(process.argv[2] ?? "") ||
  !output ||
  output.startsWith("--") ||
  !engineFunctions ||
  !bundledNamesOfModules ||
  !bundledHelpers ||
  (archive && !evaluatedModules)
) {
  console.error(
    "Usage: bun src/codegen/builtins-manifest.ts --debug=[OFF|ON] <manifest> [<archive>] --engine-functions=<aot_engine_functions.json> --bundled-names-of-modules=<bundled_names_of_modules.txt> --evaluated-modules=<InternalModuleRegistryConstants.bin> --bundled-helpers=<runtime.out.js> [--engine-directory=<Source/JavaScriptCore/aot>]",
  );
  process.exit(1);
}

const lines = ["bun-builtins-manifest\t6"];

function canonicalJSON(name: string, text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    throw new Error(`runtime define ${name} is not valid JSON: ${text}`);
  }
}

const fixed: Record<string, string> = {
  IS_BUN_DEVELOPMENT: "false",
  "process.env.NODE_ENV": '"production"',
};
for (const [key, value] of Object.entries({ ...define, ...fixed })) {
  if (globalsToPrefix.includes(key)) continue;
  const name = key.startsWith("__intrinsic__") ? "$" + key.slice("__intrinsic__".length) : key;
  lines.push(`define\t${name}\t${canonicalJSON(name, value)}`);
}

for (let id = 0; id < moduleList.length; id++) {
  const file = moduleList[id];
  lines.push(
    id < nativeStartIndex ? `module\t${id}\t${file}\t${specifierOf(file) ?? "-"}` : `module\t${id}\t-\t${file}`,
  );
}
for (const helper of helperModules) {
  lines.push(`module\t${helper.id}\t${helper.path}\t${helper.specifier}`);
}

const engine: EngineFunctions = JSON.parse(fs.readFileSync(engineFunctions, "utf8"));
const engineTexts = new Map(
  engine.files
    .filter(file => file.name.endsWith(".js") || file.name.endsWith(".ts"))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((file): [string, string] => ["engine/" + file.name, file.text]),
);

for (const file of [...functionFiles, ...engineTexts.keys()]) {
  lines.push(`functions\t${file}`);
}
for (const [key, id] of functionIds) {
  lines.push(`function\t${id}\tbuiltins/${key}`);
}
for (const { id, file, name, exportName } of engine.functions) {
  if (!engineTexts.has(`engine/${file}`)) {
    throw new Error(`${engineFunctions} has the function ${name} of ${file}, which is not one of its files`);
  }
  lines.push(`function\t${id}\tengine/${file}\t${exportName}`);
}

function mergeTsconfig(): string {
  if (own.extends !== "../../tsconfig.base.json" || "extends" in base) {
    throw new Error(
      'src/js/tsconfig.json must extend "../../tsconfig.base.json", which must extend nothing: the archive merges these two files only',
    );
  }
  return JSON.stringify({ compilerOptions: { ...base.compilerOptions, ...own.compilerOptions } });
}

// `$BunModules` says what `require` answers for every module of the directory. A build reads the line of a module with the module:
// a file that names them all would make every build read them all. A file that writes `$BunModules["name"]` as a type brings the
// line of that module too.
function splitListOfModules(text: string): { rest: string; listings: Map<string, string> } {
  const listingOf = (source: string) => source.replace(/\.[jt]s$/, ".listed.d.ts");
  const sources = [...sourceFiles, ...functionFiles];
  const linesOfModule = new Map<string, string[]>();
  const moduleOfName = new Map<string, string>();
  const rest: string[] = [];
  let isInList = false;
  let hasList = false;
  for (const line of text.split("\n")) {
    if (line === "interface $BunModules {") isInList = hasList = true;
    else if (isInList && line === "}") isInList = false;
    const [, name, imported] =
      (isInList && /^  "([^"]+)": \$ModuleValue<typeof import\("\.\/([^"]+)"\)>;$/.exec(line)) || [];
    const source = imported && [".ts", ".js"].map(extension => imported + extension).find(it => sources.includes(it));
    if (!source) {
      rest.push(line);
      continue;
    }
    moduleOfName.set(name, source);
    const own = line.replace(`"./${imported}"`, `"./${path.posix.basename(imported)}"`);
    linesOfModule.set(source, [...(linesOfModule.get(source) ?? []), own]);
  }
  if (!hasList || isInList || linesOfModule.size === 0) {
    throw new Error("src/js/private.d.ts must declare `interface $BunModules {`, a line a module, up to a line `}`");
  }
  const listings = new Map<string, string>();
  for (const source of sources) {
    const named = fs.readFileSync(locate(source), "utf8").matchAll(/\$BunModules\["([^"]+)"\]/g);
    const others = new Set([...named].map(([, name]) => moduleOfName.get(name)).filter(it => it && it !== source));
    const references = [...others]
      .sort()
      .map(other => `/// <reference path="${path.posix.relative(path.posix.dirname(source), listingOf(other!))}" />`);
    const own = linesOfModule.get(source);
    if (references.length === 0 && !own) continue;
    listings.set(
      listingOf(source),
      [...references, ...(own ? ["interface $BunModules {", ...own, "}"] : []), ""].join("\n"),
    );
  }
  return { rest: rest.join("\n"), listings };
}

const listOfModules = splitListOfModules(fs.readFileSync(locate("private.d.ts"), "utf8"));
for (const listing of listOfModules.listings.keys()) {
  lines.push(`declarations\t${listing}`);
}

// What `declare global` and `declare module "name"` add is seen by files that do not name the file, so every build reads it:
// the part of the file that these declarations lead to, and the rest once a file that is read names the file.
for (const [file, text] of [
  ...[...sourceFiles, ...functionFiles].map((file): [string, string] => [file, fs.readFileSync(locate(file), "utf8")]),
  ...engineTexts,
]) {
  if (!/^\s*declare\s+(global\b|module\s*["'])/m.test(text)) continue;
  const { seen, asked } = rangesSeenByEveryFile(file, text);
  lines.push(`declares-for-every-file\t${file}\t${seen.join(" ")}\t${asked.join(" ") || "-"}`);
}

// The positions of each module stand behind its id and their length.
const bundledPositions: Uint8Array[] = [];
for (const line of fs.readFileSync(bundledNamesOfModules, "utf8").split("\n")) {
  const [kind, file, encoded] = line.split("\t");
  if (line === "") continue;
  if (kind !== "positions") {
    // The names are those of the text that was bundled.
    const bundled = path.join(import.meta.dir, "../js", file);
    if (locate(file) === bundled) lines.push(line);
    else
      lines.push(
        ...moveBundledNamesToSecondText(
          [line],
          fs.readFileSync(locate(file), "utf8"),
          fs.readFileSync(bundled, "utf8"),
        ),
      );
    continue;
  }
  const positions = Buffer.from(encoded, "base64");
  bundledPositions.push(encodeNumbers([moduleList.indexOf(file), positions.length]), positions);
}

const manifest = lines.join("\n") + "\n";
fs.mkdirSync(path.dirname(output), { recursive: true });
writeIfNotChanged(output, manifest);

// A build reads nothing of the comments of a declaration file but the directives behind three slashes. Copyright notices stay.
export function withoutComments(text: string): string {
  let out = "";
  let braces = 0;
  const substitutions: number[] = [];
  const copyTo = (from: number, end: number) => ((out += text.slice(from, end)), end);
  const endOfTemplateText = (from: number) => {
    for (let i = from; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "`") return i + 1;
      else if (text[i] === "$" && text[i + 1] === "{") return (substitutions.push(braces), i + 2);
    }
    return text.length;
  };
  for (let i = 0; i < text.length;) {
    const [c, next] = [text[i], text[i + 1]];
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const behind = end < 0 ? text.length : end + 2;
      const comment = text.slice(i, behind);
      out += /copyright/i.test(comment) ? comment : comment.includes("\n") ? "\n" : " ";
      i = behind;
    } else if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const behind = end < 0 ? text.length : end;
      i = text[i + 2] === "/" ? copyTo(i, behind) : behind;
    } else if (c === '"' || c === "'") {
      let end = i + 1;
      while (end < text.length && text[end] !== c) end += text[end] === "\\" ? 2 : 1;
      i = copyTo(i, end + 1);
    } else if (c === "`") {
      i = copyTo(i, endOfTemplateText(i + 1));
    } else if (c === "}" && substitutions.at(-1) === braces) {
      substitutions.pop();
      i = copyTo(i, endOfTemplateText(i + 1));
    } else {
      braces += c === "{" ? 1 : c === "}" ? -1 : 0;
      i = copyTo(i, i + 1);
    }
  }
  return out.replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n");
}

// What a build reads in place of `@types/bun` where a project has not installed it.
function declarationsOfRuntime(): [string, Buffer][] {
  const bunTypes = path.join(import.meta.dirname, "..", "..", "packages", "bun-types");
  const installed = (name: string) => path.dirname(Bun.resolveSync(`${name}/package.json`, bunTypes));
  const packages = {
    "bun-types": bunTypes,
    "@types/node": installed("@types/node"),
    "undici-types": installed("undici-types"),
  };
  const files: [string, Buffer][] = [
    ["types/@types/bun/package.json", Buffer.from(`{"name":"@types/bun","types":"./index.d.ts"}\n`)],
    ["types/@types/bun/index.d.ts", Buffer.from(`/// <reference types="bun-types" />\n`)],
  ];
  for (const [name, directory] of Object.entries(packages)) {
    const declarations = [...new Bun.Glob("**/*.d.ts").scanSync({ cwd: directory })].map(file =>
      file.replaceAll("\\", "/"),
    );
    for (const file of name === "bun-types" ? ["package.json"] : ["package.json", "LICENSE"]) {
      files.push([`types/${name}/${file}`, fs.readFileSync(path.join(directory, file))]);
    }
    for (const file of declarations.filter(file => !file.includes("node_modules/"))) {
      files.push([
        `types/${name}/${file}`,
        Buffer.from(withoutComments(fs.readFileSync(path.join(directory, file), "utf8"))),
      ]);
    }
  }
  return files;
}

/** The texts that `bun run` evaluates, by the id of the module: the section that bundle-modules.ts writes. */
function readEvaluatedModules(file: string): Buffer[] {
  const section = fs.readFileSync(file);
  const [count, records, data] = [16, 20, 32].map(at => section.readUInt32LE(at));
  return Array.from({ length: count }, (_, id) => {
    const [start, length] = [16, 20].map(at => section.readUInt32LE(records + id * 24 + at));
    return section.subarray(data + start, data + start + length);
  });
}

if (archive) {
  const nameLength = 63;
  const recordLength = 1 + nameLength + 4 + 4 + 4;
  // Every Bun holds the text of a module that `bun run` evaluates, and most of the module is found in it.
  const evaluated = readEvaluatedModules(evaluatedModules!);
  const files = [...sourceFiles, ...functionFiles, "builtins.d.ts"].map((file): [string, Buffer] => [
    file,
    fs.readFileSync(locate(file)),
  ]);
  for (const helper of helperModules) files.push([helper.path, fs.readFileSync(helper.source ?? bundledHelpers)]);
  files.push(["private.d.ts", Buffer.from(listOfModules.rest)]);
  for (const [file, text] of listOfModules.listings) files.push([file, Buffer.from(text)]);
  for (const [file, text] of engineTexts) files.push([file, Buffer.from(text)]);
  files.push(["tsconfig.json", Buffer.from(mergeTsconfig())]);
  files.push(...declarationsOfRuntime());
  files.push(["positions", Buffer.concat(bundledPositions)]);
  files.push(["manifest", Buffer.from(manifest)]);
  files.sort(([a], [b]) => (a < b ? -1 : 1));
  // The installed types of node:zlib do not list `pledgedSrcSize`, with which the frame says how long its text is.
  const compress = (text: Buffer, dictionary?: Buffer) => {
    const options: ZstdOptions & { pledgedSrcSize: number } = {
      pledgedSrcSize: text.length,
      params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_contentSizeFlag]: 1 },
      dictionary,
    };
    return zstdCompressSync(text, options);
  };
  const frames = files.map(([name, text]) => compress(text, evaluated[sourceFiles.indexOf(name)]));
  // The list of the files, compressed, stands behind its length. Its offsets count from where it ends.
  const records = Buffer.alloc(files.length * recordLength);
  let offset = 0;
  for (const [i, [name]] of files.entries()) {
    if (name.length > nameLength) throw new Error(`${name} is longer than ${nameLength} bytes`);
    const record = i * recordLength;
    records.writeUInt8(name.length, record);
    records.write(name, record + 1, "latin1");
    records.writeUInt32LE(offset, record + 1 + nameLength);
    records.writeUInt32LE(frames[i].length, record + 1 + nameLength + 4);
    // One more than the id of the module whose evaluated text the file follows on.
    records.writeUInt32LE(sourceFiles.indexOf(name) + 1, record + 1 + nameLength + 8);
    offset += frames[i].length;
  }
  const list = compress(records);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(list.length, 0);
  writeIfNotChangedBinary(archive, Buffer.concat([header, list, ...frames]));
}
