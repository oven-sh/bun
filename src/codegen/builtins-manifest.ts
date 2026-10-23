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

const manifest = lines.join("\n") + "\n";
fs.mkdirSync(path.dirname(output), { recursive: true });
writeIfNotChanged(output, manifest);

if (archive) {
  const nameLength = 63;
  const recordLength = 1 + nameLength + 4 + 4;
  const files = [
    ...sourceFiles,
    ...helperModules.map(helper => helper.path),
    ...functionFiles,
    "builtins.d.ts",
    "private.d.ts",
  ].map((file): [string, Buffer] => [file, fs.readFileSync(locate(file))]);
  for (const [file, text] of engineTexts) files.push([file, Buffer.from(text)]);
  files.push(["tsconfig.json", Buffer.from(mergeTsconfig())]);
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
