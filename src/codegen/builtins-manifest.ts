// Writes the tables `bun build --target=bun_builtins` reads (src/builtin_syntax/lib.rs). One record per line, fields
// separated by tabs, "-" for none:
//
//   development  0|1
//   define       key, value             as --define takes them; `$name` in a key is a private name
//   global       name                   read through the private name of the same spelling
//   name         name, kind             `$name` exists
//   error        name, code             `$name(..)` is `$makeErrorWithCode(code, ..)`
//   class        name, id               `$inherits<name>(..)` is `$inherits(id, ..)`
//   module       id, path, specifier, label, name
//   functions    path                   a file of builtin functions
//   function     id, path, name         what native code asks a compiled program for the function by
//   native       id, macro, file, symbol
//   requires     id, id..               the modules that the first can require, eagerly or lazily
//   first_tick   id                     the first tick of the event loop evaluates it
//   always       id                     native code may require it, whatever the program does
//   trigger      global.property, id..  native code requires them once the program reads that property
//
// With a second output file, also the archive `bun build --compile-aot` compiles the modules from: their sources as they
// are written, the two declaration files, and the manifest. The format is described in src/builtin_syntax/lib.rs.
//
// Usage: bun src/codegen/builtins-manifest.ts --debug=[OFF|ON] <manifest> [<archive>]
import fs from "node:fs";
import path from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
import NodeErrors from "../jsc/bindings/ErrorCode.ts";
import jsclasses from "../jsc/bindings/js_classes";
import { census, uncurryThisMismatch } from "./builtin-name-census";
import { builtinFunctionIds } from "./builtin-function-ids";
import { jscNames, typeNames } from "./builtin-names";
// replacements.ts and builtin-parser.ts import each other, and only this one can be entered first.
import "./builtin-parser";
import { registerNativeCall } from "./generate-js2native";
import { writeIfNotChanged, writeIfNotChangedBinary } from "./helpers";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";
import { define, globalsToPrefix } from "./replacements";

const debug = process.argv[2] === "--debug=ON";
const output = process.argv[3];
const archive = process.argv[4];
if (!/^--debug=(OFF|ON)$/.test(process.argv[2] ?? "") || !output) {
  console.error("Usage: bun src/codegen/builtins-manifest.ts --debug=[OFF|ON] <manifest> [<archive>]");
  process.exit(1);
}

const BASE = path.join(import.meta.dir, "../js");
const { moduleList, nativeStartIndex } = createInternalModuleRegistry(BASE);

const lines = ["bun-builtins-manifest\t3", `development\t${debug ? 1 : 0}`];

for (const [key, value] of Object.entries(define)) {
  if (globalsToPrefix.includes(key)) continue;
  lines.push(`define\t${key.startsWith("__intrinsic__") ? "$" + key.slice("__intrinsic__".length) : key}\t${value}`);
}

for (const name of globalsToPrefix) {
  lines.push(`global\t${name}`);
}

const functionFiles = fs
  .readdirSync(path.join(BASE, "builtins"))
  .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .sort()
  .map(file => "builtins/" + file);
// JavaScriptCore's own, in the same syntax: Source/JavaScriptCore/Scripts/generate-aot-builtins.py writes most of them.
const ENGINE = path.join(import.meta.dir, "../aot/prelude/engine");
functionFiles.push(
  ...fs
    .readdirSync(ENGINE)
    .filter(file => file.endsWith(".js") || file.endsWith(".ts"))
    .sort()
    .map(file => "engine/" + file),
);
const locate = (file: string) => (file.startsWith("engine/") ? path.join(ENGINE, file.slice(7)) : path.join(BASE, file));
const read = (file: string) => fs.readFileSync(locate(file), "utf8");

const names = new Map<string, string>();
const addNames = (kind: string, list: Iterable<string>) => {
  for (const name of list) {
    if (!names.has(name)) names.set(name, kind);
  }
};
for (const [kind, list] of Object.entries(jscNames)) addNames(kind, list);
addNames(
  "private",
  read("builtins/BunBuiltinNames.h")
    .matchAll(/^\s*macro\((\w+)\)/gm)
    .map(match => match[1]),
);
for (const file of functionFiles) {
  addNames(
    "function",
    read(file)
      .matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)
      .map(match => match[1]),
  );
}
addNames("type", typeNames);
for (const [name, kind] of names) {
  lines.push(`name\t${name}\t${kind}`);
}

let code = 0;
for (const [name, _constructor, _name, ...otherConstructors] of NodeErrors) {
  lines.push(`error\t${name}\t${code++}`);
  for (const constructor of otherConstructors) {
    if (constructor == null) continue;
    lines.push(`error\t${name}_${constructor.name}\t${code++}`);
  }
}

for (let id = 0; id < jsclasses.length; id++) {
  lines.push(`class\t${jsclasses[id][0]}\t${id}`);
}

function specifierOf(file: string) {
  if (file === "internal-for-testing.ts") return "bun:internal-for-testing";
  const prefix = file.startsWith("node/")
    ? "node:"
    : file.startsWith("bun/")
      ? "bun:"
      : file.startsWith("internal/")
        ? "internal/"
        : undefined;
  return prefix ? prefix + file.slice(prefix.length).replaceAll(".", "/").slice(0, -3) : "-";
}

function labelOf(file: string) {
  const id = file.replace(/\.[mc]?[tj]s$/, "");
  if (id.startsWith("node/")) return id.slice(5).replaceAll(".", "/");
  if (id.startsWith("bun/")) return id.slice(4).replaceAll(".", "/");
  if (id.startsWith("internal/")) return "internal:" + id.slice(9).replaceAll(".", "/");
  if (id.startsWith("thirdparty/")) return id.slice(11).replaceAll(".", "/");
  return id;
}

// `idToPublicSpecifierOrEnumName` of bundle-modules.ts: what the module loader, the builtins section of an executable and
// stack frames call it.
function nameOf(file: string) {
  if (file === "internal-for-testing.ts") return "bun:internal-for-testing";
  const label = labelOf(file);
  return file.startsWith("node/") ? "node:" + label : file.startsWith("bun/") ? "bun:" + label : label;
}

for (let id = 0; id < moduleList.length; id++) {
  const file = moduleList[id];
  lines.push(
    id < nativeStartIndex
      ? `module\t${id}\t${file}\t${specifierOf(file)}\t${labelOf(file)}\t${nameOf(file)}`
      : `module\t${id}\t-\t${file}\t${file}\t${file}`,
  );
}

// An id is the position of the first call of a native function, over the modules in registry order and then the files
// of builtin functions. The transpiler's output tells a call from the same text in a comment.
const nativeCall =
  /\$(cpp|rust|newCppFunction|newRustFunction|bindgenFn)\(\s*(["'])([^"'\n]+)\2\s*,\s*(["'])([^"'\n]+)\4\s*(?:,\s*(\d+)\s*)?,?\s*\)/g;
const transpiler = new Bun.Transpiler({ loader: "ts" });
const keyOf = (match: RegExpMatchArray) => `${match[1]}\t${match[3]}\t${match[5]}`;
const seen = new Set<string>();

for (const file of [...moduleList.slice(0, nativeStartIndex), ...functionFiles]) {
  const source = read(file);
  const calls = new Set(transpiler.transformSync(source).matchAll(nativeCall).map(keyOf));
  for (const match of source.matchAll(nativeCall)) {
    const key = keyOf(match);
    if (!calls.has(key)) continue;
    const [, macro, , nativeFile, , symbol, length] = match;
    if (macro.startsWith("new") !== (length !== undefined)) {
      throw new Error(`$${macro} takes ${macro.startsWith("new") ? "three" : "two"} arguments, but got '${match[0]}'`);
    }
    const kind = macro === "bindgenFn" ? "bind" : macro.includes("ust") ? "rust" : "cpp";
    const id = registerNativeCall(kind, nativeFile, symbol, length === undefined ? null : Number(length));
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`native\t${id}\t${key}`);
  }
}

// As `Manifest::resolve` does.
const sourceFiles = moduleList.slice(0, nativeStartIndex);
const idOfPath = new Map(sourceFiles.map((file, id) => [file, id]));
const idOfSpecifier = new Map(moduleList.map((file, id) => [id < nativeStartIndex ? specifierOf(file) : file, id]));
function resolve(specifier: string, importer: string) {
  const named = idOfSpecifier.get(specifier);
  if (named !== undefined) return named;
  for (const directory of [path.posix.dirname(importer), "."]) {
    const joined = path.posix.join(directory, specifier);
    for (const extension of ["", ".ts", ".js"]) {
      const id = idOfPath.get(joined + extension);
      if (id !== undefined) return id;
    }
  }
  throw new Error(`"${specifier}" in ${importer || "builtins-manifest.ts"} is no internal module`);
}
const idsOf = (specifiers: string[]) => specifiers.map(specifier => resolve(specifier, ""));

const console_ = ["node:util", "internal/validators", "internal/util/debuglog"];
const ipc = ["node:net", "node:dgram", "internal/dgram", "node:fs", "internal/serialization_buffers"];
const standardStream = ["node:tty", "node:fs", "internal/fs/streams"];

// What a module requires through native code or a builtin function: no `require("..")` in its text says so.
const requiredBesides: Record<string, string[]> = {
  "node:fs/promises": ["internal/fifo"],
  "node:console": console_,
  "internal/promisify": ["node:timers/promises"],
  "node:worker_threads": ["internal/worker/stdio"],
  "node:child_process": ipc,
};

for (const [id, file] of sourceFiles.entries()) {
  const required = transpiler
    .scanImports(read(file))
    .filter(record => record.kind === "require-call")
    .map(record => resolve(record.path, file))
    .concat(idsOf(requiredBesides[specifierOf(file)] ?? []))
    .filter(required => required !== id);
  if (required.length) lines.push(`requires\t${id}\t${[...new Set(required)].sort((a, b) => a - b).join("\t")}`);
}

// The queue of `process.nextTick`, which native code fills by itself.
const firstTick = [
  "internal/process/next_tick_queue",
  "internal/validators",
  "internal/shared",
  "internal/fixed_queue",
  "internal/async_hooks_tick",
];
for (const id of idsOf(firstTick)) {
  lines.push(`first_tick\t${id}`);
}

// `node:util`: `console.log` of an object with a `nodejs.util.inspect.custom` method, which Bun's own classes have.
// `node:path`: a warning that native code emits.
for (const id of idsOf(["node:util", "node:path"])) {
  lines.push(`always\t${id}`);
}

for (const file of functionFiles) {
  lines.push(`functions\t${file}`);
}
for (const line of fs.readFileSync(path.join(ENGINE, "functions.txt"), "utf8").split("\n").filter(Boolean)) {
  const [id, file, name] = line.split("\t");
  lines.push(`function\t${id}\tengine/${file}\t${name}`);
}
for (const [key, id] of builtinFunctionIds(path.join(BASE, "builtins"))) {
  lines.push(`function\t${id}\tbuiltins/${key}`);
}

// What a builtin function requires is here or in `requiredBesides`, under what makes native code call the function.
const triggers: Record<string, string[]> = {
  "process.stdout": standardStream,
  "process.stderr": standardStream,
  "process.stdin": standardStream,
  "process.openStdin": standardStream,
  "process.channel": ["node:events"],
  "process.send": ipc,
  "process._rawDebug": ["node:util", "node:fs", "node:os"],
  "process.loadEnvFile": ["internal/validators", "node:fs", "node:util"],
  "console.Console": console_,
  "Bun.spawn": ipc,
  "Bun.sql": ["bun:sql"],
  "Bun.SQL": ["bun:sql"],
  "Bun.postgres": ["bun:sql"],
};
for (const [property, specifiers] of Object.entries(triggers)) {
  lines.push(`trigger\t${property}\t${idsOf(specifiers).join("\t")}`);
}

// Every `$name` that src/js uses has a row that says what the AoT front end makes of it, and every row a use.
// `name, position` is a row, `PREFIX*, position` one for every name that starts so and has no row of its own, and
// `name, Value, hardened` one for a global that is read through the private name of the same spelling.
const rows = fs
  .readFileSync(path.join(import.meta.dir, "../aot/build/intrinsics.txt"), "utf8")
  .split("\n")
  .filter(line => line)
  .map(line => line.split("\t"));
const keyOfRow = (name: string, position: string) => `${name}\t${position}`;
const unused = new Set(rows.filter(row => row[2] !== "hardened").map(([name, position]) => keyOfRow(name, position)));
const plain = new Set(rows.filter(([name]) => !name.endsWith("*")).map(([name, position]) => keyOfRow(name, position)));
const prefixes = rows.filter(([name]) => name.endsWith("*")).map(([name, position]) => [name.slice(0, -1), position]);
const failures: string[] = [];
for (const use of census([...sourceFiles, ...functionFiles].map(locate))) {
  const key = keyOfRow(use.name, use.position);
  const prefix = prefixes.find(([prefix, position]) => position === use.position && use.name.startsWith(prefix));
  if (plain.has(key)) unused.delete(key);
  else if (prefix) unused.delete(keyOfRow(prefix[0] + "*", prefix[1]));
  else failures.push(`${use.file}:${use.line}: $${use.name} as ${use.position} has no row in aot/builtins/bun.def`);
}
for (const key of unused) {
  failures.push(`aot/builtins/bun.def: nothing in src/js uses $${key.replace("\t", " as ")}`);
}
const hardened = rows.filter(row => row[2] === "hardened").map(row => row[0]);
for (const name of new Set(hardened).symmetricDifference(new Set(globalsToPrefix))) {
  failures.push(`${name} is hardened in one of aot/builtins/bun.def and src/codegen/replacements.ts, not in both`);
}
const mismatch = uncurryThisMismatch(path.join(BASE, "internal/primordials.js"));
if (mismatch) {
  failures.push(`internal/primordials.js no longer has \`${mismatch}\`: see src/sema/check/aot/builtin_constants.rs`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const manifest = lines.join("\n") + "\n";
fs.mkdirSync(path.dirname(output), { recursive: true });
writeIfNotChanged(output, manifest);

if (archive) {
  const nameLength = 63;
  const recordLength = 1 + nameLength + 4 + 4;
  // By bytes, which is how they are searched. The names are ASCII.
  const files = [...sourceFiles, ...functionFiles, "builtins.d.ts", "private.d.ts"].map(file => [
    file,
    fs.readFileSync(locate(file)),
  ]);
  files.push(["manifest", Buffer.from(manifest)]);
  files.sort(([a], [b]) => (a < b ? -1 : 1));
  const frames = files.map(([, text]) =>
    zstdCompressSync(text, {
      pledgedSrcSize: text.length,
      params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_contentSizeFlag]: 1 },
    }),
  );
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
