import fs from "node:fs";
import path from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
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
import { writeIfNotChanged, writeIfNotChangedBinary } from "./helpers";
import { define, globalsToPrefix } from "./replacements";

const output = process.argv[3];
const archive = process.argv[4]?.startsWith("--") ? undefined : process.argv[4];
const flagValue = (flag: string) =>
  process.argv
    .slice(4)
    .find(argument => argument.startsWith(flag))
    ?.slice(flag.length);
const engineFunctions = flagValue("--engine-functions=");
if (!/^--debug=(OFF|ON)$/.test(process.argv[2] ?? "") || !output || output.startsWith("--") || !engineFunctions) {
  console.error(
    "Usage: bun src/codegen/builtins-manifest.ts --debug=[OFF|ON] <manifest> [<archive>] --engine-functions=<aot_engine_functions.json> [--engine-directory=<Source/JavaScriptCore/aot>]",
  );
  process.exit(1);
}

const lines = ["bun-builtins-manifest\t4"];

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
  lines.push(`module\t${helper.id}\t${helper.path}\t${helper.specifier ?? "-"}`);
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
  const sources = [...sourceFiles, ...helperModules.map(helper => helper.path), ...functionFiles];
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

if (archive) {
  const nameLength = 63;
  const recordLength = 1 + nameLength + 4 + 4;
  const files = [...sourceFiles, ...helperModules.map(helper => helper.path), ...functionFiles, "builtins.d.ts"].map(
    (file): [string, Buffer] => [file, fs.readFileSync(locate(file))],
  );
  files.push(["private.d.ts", Buffer.from(listOfModules.rest)]);
  for (const [file, text] of listOfModules.listings) files.push([file, Buffer.from(text)]);
  for (const [file, text] of engineTexts) files.push([file, Buffer.from(text)]);
  files.push(["tsconfig.json", Buffer.from(mergeTsconfig())]);
  files.push(...declarationsOfRuntime());
  files.push(["manifest", Buffer.from(manifest)]);
  files.sort(([a], [b]) => (a < b ? -1 : 1));
  const frames = files.map(([, text]) => {
    const options = {
      pledgedSrcSize: text.length,
      params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_contentSizeFlag]: 1 },
    };
    return zstdCompressSync(text, options);
  });
  const header = Buffer.alloc(4 + files.length * recordLength);
  header.writeUInt32LE(files.length, 0);
  let offset = header.length;
  for (const [i, [name]] of files.entries()) {
    if (name.length > nameLength) throw new Error(`${name} is longer than ${nameLength} bytes`);
    const record = 4 + i * recordLength;
    header.writeUInt8(name.length, record);
    header.write(name, record + 1, "latin1");
    header.writeUInt32LE(offset, record + 1 + nameLength);
    header.writeUInt32LE(frames[i].length, record + 1 + nameLength + 4);
    offset += frames[i].length;
  }
  writeIfNotChangedBinary(archive, Buffer.concat([header, ...frames]));
}
