import fs from "node:fs";
import path from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
import NodeErrors from "../jsc/bindings/ErrorCode.ts";
import jsclasses from "../jsc/bindings/js_classes";
import { census, uncurryThisMismatch } from "./builtin-name-census";
import { builtinFunctionIds } from "./builtin-function-ids";
import { jscNames, typeNames } from "./builtin-names";
import "./builtin-parser";
import { registerNativeCall } from "./generate-js2native";
import { writeIfNotChanged, writeIfNotChangedBinary } from "./helpers";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";
import { define, globalsToPrefix } from "./replacements";

const debug = process.argv[2] === "--debug=ON";
const output = process.argv[3];
const archive = process.argv[4]?.startsWith("--") ? undefined : process.argv[4];
const typesOnlyFlag = process.argv.find(argument => argument.startsWith("--types-only="));
const isTypesOnly = (schema: string) =>
  typesOnlyFlag ? typesOnlyFlag.split("=")[1].split(",").includes(schema) : !debug && schema.endsWith("_test.bind.ts");
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

const nativeCall =
  /\$(cpp|rust|newCppFunction|newRustFunction|bindgen)\(\s*(["'])([^"'\n]+)\2\s*,\s*(["'])([^"'\n]+)\4\s*(?:,\s*(\d+)\s*)?,?\s*\)/g;
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
    if (macro === "bindgen" && isTypesOnly(nativeFile)) continue;
    if (macro.startsWith("new") !== (length !== undefined)) {
      throw new Error(`$${macro} takes ${macro.startsWith("new") ? "three" : "two"} arguments, but got '${match[0]}'`);
    }
    const kind = macro === "bindgen" ? "bind" : macro.includes("ust") ? "rust" : "cpp";
    const id = registerNativeCall(kind, nativeFile, symbol, length === undefined ? null : Number(length));
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`native\t${id}\t${key}`);
  }
}

const sourceFiles = moduleList.slice(0, nativeStartIndex);
const pathId = new Map(sourceFiles.map((file, id) => [file, id]));
const specifierId = new Map(moduleList.map((file, id) => [id < nativeStartIndex ? specifierOf(file) : file, id]));
function resolve(specifier: string, importer: string) {
  const named = specifierId.get(specifier);
  if (named !== undefined) return named;
  for (const directory of [path.posix.dirname(importer), "."]) {
    const joined = path.posix.join(directory, specifier);
    for (const extension of ["", ".ts", ".js"]) {
      const id = pathId.get(joined + extension);
      if (id !== undefined) return id;
    }
  }
  throw new Error(`"${specifier}" in ${importer || "builtins-manifest.ts"} is no internal module`);
}
const idsOf = (specifiers: string[]) => specifiers.map(specifier => resolve(specifier, ""));

const console_ = ["internal/util/inspect", "internal/validators", "internal/util/debuglog"];
const ipc = ["node:net", "node:dgram", "internal/dgram", "node:fs", "internal/serialization_buffers"];
const standardStream = ["node:tty", "node:fs", "internal/fs/streams"];

const alsoRequired: Record<string, string[]> = {
  "node:fs/promises": ["internal/fifo"],
  "node:console": console_,
  "node:events": standardStream,
  "internal/promisify": ["node:timers/promises"],
  "node:worker_threads": ["internal/worker/stdio"],
  "node:child_process": ipc,
  "node:repl": standardStream,
};

const triggers: Record<string, string[]> = {
  "process.stdout": standardStream,
  "process.stderr": standardStream,
  "process.stdin": standardStream,
  "process.openStdin": standardStream,
  "process.channel": [...ipc, "node:events"],
  "process.disconnect": ipc,
  "process.send": ipc,
  "process._rawDebug": ["internal/util/inspect", "node:fs", "node:os"],
  "process.loadEnvFile": ["internal/validators", "node:fs"],
  "console.Console": console_,
  "console._stdout": standardStream,
  "console._stderr": standardStream,
  "Bun.spawn": ipc,
  "Bun.sql": ["bun:sql"],
  "Bun.SQL": ["bun:sql"],
  "Bun.postgres": ["bun:sql"],
};
const patternNames = (code: string, global: string) =>
  [...code.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${global}\\b(?!\\s*[.(\\[?])`, "g"))].flatMap(([, names]) =>
    names.split(",").map(name => name.split(/[:=]/)[0].trim()),
  );
const hasOpaquePropertyReads = (code: string, global: string) =>
  new RegExp(
    `(?<![=!<>}]\\s*)(?:=|\\|\\|=|&&=|\\?\\?=)\\s*${global}\\s*(?:[;,)\\n]|$)|\\}\\s*\\}\\s*=\\s*${global}\\b|(?<![.\\w$])${global}\\s*(?:\\?\\.)?\\[`,
    "m",
  ).test(code);
const modulesKnownToAlias: Record<string, string[]> = {
  "node:repl": ["process"],
  "node:worker_threads": ["process"],
};
const modulesTriggeredBy = (file: string) => {
  const code = transpiler.transformSync(read(file));
  for (const global of new Set(Object.keys(triggers).map(property => property.split(".")[0]))) {
    if (hasOpaquePropertyReads(code, global) && !modulesKnownToAlias[specifierOf(file)]?.includes(global)) {
      throw new Error(
        `${file} aliases ${global}, reads it by a computed name or takes it apart in a nested pattern, so \`triggers\` cannot tell which of its properties the module reads. Write ${global}.<property>, or add the module to \`modulesKnownToAlias\` and what it needs to \`alsoRequired\`.`,
      );
    }
  }
  return Object.entries(triggers)
    .filter(([trigger]) => {
      const [global, property] = trigger.split(".");
      return new RegExp(`\\b${global}\\??\\.${property}\\b`).test(code) || patternNames(code, global).includes(property);
    })
    .flatMap(([, specifiers]) => specifiers);
};

for (const [id, file] of sourceFiles.entries()) {
  const required = transpiler
    .scanImports(read(file))
    .filter(record => record.kind === "require-call")
    .map(record => resolve(record.path, file))
    .concat(idsOf(alsoRequired[specifierOf(file)] ?? []))
    .filter(required => required !== id);
  if (required.length) lines.push(`requires\t${id}\t${[...new Set(required)].sort((a, b) => a - b).join("\t")}`);
}
for (const [specifier, besides] of Object.entries(alsoRequired)) {
  lines.push(`besides\t${resolve(specifier, "")}\t${idsOf(besides).join("\t")}`);
}
for (const [id, file] of sourceFiles.entries()) {
  const triggered = idsOf(modulesTriggeredBy(file)).filter(required => required !== id);
  if (triggered.length) lines.push(`triggered\t${id}\t${[...new Set(triggered)].sort((a, b) => a - b).join("\t")}`);
}

const alwaysIncluded = [
  "internal/process/next_tick_queue",
  "internal/util/inspect",
  "node:timers/promises",
  "node:path",
];
for (const id of idsOf(alwaysIncluded)) {
  lines.push(`always\t${id}`);
}

for (const file of functionFiles) {
  lines.push(`functions\t${file}`);
}
const functionIds = builtinFunctionIds(path.join(BASE, "builtins"));
for (const [key, id] of functionIds) {
  lines.push(`function\t${id}\tbuiltins/${key}`);
}
for (const line of fs.readFileSync(path.join(ENGINE, "functions.txt"), "utf8").split("\n").filter(Boolean)) {
  const [id, file, name] = line.split("\t");
  lines.push(`function\t${id}\tengine/${file}\t${name}`);
  functionIds.set(`engine/${file}\t${name}`, Number(id));
}

const keysAreIndexesOrSymbols = { "property *": [], "finds Function": [] };
const keysAreCountedAtTheCaller = { "property *": [], "finds Function": [] };
const readsOnlyItsOwnNewObject = { "property *": [], "finds Function": [] };
const buffers = { "*": ["global Buffer", "native node:buffer"] };
const whereTheProgramNames = (...names: string[]) => [...names.flatMap(name => [`program-property ${name}`, `program-key ${name}`]), "program-key *"];
const keysAreSymbolsIndexesOrOfFixedLists = { "finds Function": [] };
const readsPlainObjectsAndFixedLists = { "finds Function": [] };
const readsTablesWithoutPrototypeOrByTheirOwnKeys = { "finds Function": [] };
const neitherCallsNorHandsOutWhatItReads = { "finds Function": [] };
const answersForAProxyWhoseKeysAreCountedAtTheCallerOrReadsItsOwnTables = { "finds Function": [] };
const holdsForEveryProperty = (reason: { "finds Function": string[] }) => ({ ...reason, "property *": reason["finds Function"] });
const givesAnObjectAnotherPrototype = ["program-property setPrototypeOf", "program-property __proto__"];
const allOf = (...lists: string[][]) => lists.reduce((all, list) => all.flatMap(one => list.map(other => `${one} & ${other}`)));
const whereTheProgramMayHaveAnInspectorOfItsOwn = [
  "program-symbol nodejs.util.inspect.custom",
  ...allOf(["program-module node:util", "Bun inspect"], ["program-symbol-key *"]),
];
const whereAnInspectorOfTheProgramMayReplaceTheStyles = allOf(whereTheProgramMayHaveAnInspectorOfItsOwn, ["program-property styles", "program-key styles"]);
const whereInspectMayCallGettersOrReadReplacedTables = [
  ...whereTheProgramMayHaveAnInspectorOfItsOwn,
  "program-module node:util",
  "program-module node:console",
  "console Console",
  "program-defined-key *",
  "program-module node:assert",
  "program-module node:assert/strict",
  "program-module node:test",
  "program-module node:dgram",
  "module node:repl",
];
const definesAnInspectorAndCallsNone = { "symbol nodejs.util.inspect.custom": [] };
const whereTheProgramTakes = (holders: string[], ...names: string[]) => [...whereTheProgramNames(...names), ...allOf(holders, ["program-member *"])];
const readsTheTableOfListeners = {
  "finds Function": [...whereTheProgramTakes(["module node:events"], "_events", "listeners", "rawListeners", "getEventListeners"), ...givesAnObjectAnotherPrototype],
};
const onBehalfOf: Record<string, Record<string, string[]>> = {
  "JSBufferConstructor.ts\tfrom": { ...keysAreIndexesOrSymbols, ...buffers },
  "JSBufferConstructor.ts\tisBuffer": buffers,
  "JSBufferPrototype.ts\toffset": buffers,
  "JSBufferPrototype.ts\tparent": buffers,
  "JSBufferPrototype.ts\ttoJSON": buffers,
  "Bake.ts\trenderRoutesForProdStatic": { ...neitherCallsNorHandsOutWhatItReads, "property *": ["Bun build"] },
  "BundlerPlugin.ts\trunOnLoadPlugins": { ...readsPlainObjectsAndFixedLists, "property *": ["Bun build", "Bun plugin", "loader html"] },
  "BundlerPlugin.ts\trunOnResolvePlugins": { ...readsPlainObjectsAndFixedLists, "property *": ["Bun build", "Bun plugin", "loader html"] },
  "CommonJS.ts\tcreateRequireCache": { ...keysAreCountedAtTheCaller, ...definesAnInspectorAndCallsNone },
  "CommonJS.ts\tgetWrapperArrayProxy": keysAreCountedAtTheCaller,
  "CommonJS.ts\tinternalRequire": { "process dlopen": ["loader napi"] },
  "CommonJS.ts\toverridableRequire": { "Bun jest": ["native bun:test"] },
  "ConsoleObject.ts\tasyncIterator": { ...keysAreSymbolsIndexesOrOfFixedLists, "property *": ["console *"] },
  "ConsoleObject.ts\tcreateConsoleConstructor": { ...keysAreSymbolsIndexesOrOfFixedLists, "property *": ["console Console"] },
  "Ipc.ts\tserialize": keysAreIndexesOrSymbols,
  "Peek.ts\tpeekStatus": keysAreIndexesOrSymbols,
  "ProcessObjectInternals.ts\tbuildAllowedNodeEnvironmentFlags": neitherCallsNorHandsOutWhatItReads,
  "ProcessObjectInternals.ts\tgetNodeWorkerStdioStream": keysAreIndexesOrSymbols,
  "ProcessObjectInternals.ts\tgetStdioWriteStream": keysAreIndexesOrSymbols,
  "ProcessObjectInternals.ts\tloadEnvFile": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "ProcessObjectInternals.ts\twindowsEnv": keysAreCountedAtTheCaller,
  "engine/ArrayConstructor.js\tfrom": keysAreIndexesOrSymbols,
  "engine/ArrayConstructor.js\tfromAsync": keysAreIndexesOrSymbols,
  "engine/ArrayIteratorPrototype.js\tarrayIteratorNextHelper": keysAreIndexesOrSymbols,
  "engine/ArrayPrototype.js\tat": keysAreIndexesOrSymbols,
  "engine/ArrayPrototype.js\tfindLast": keysAreIndexesOrSymbols,
  "engine/ArrayPrototype.js\tfindLastIndex": keysAreIndexesOrSymbols,
  "engine/ArrayPrototype.js\treduceRight": keysAreIndexesOrSymbols,
  "engine/AsyncDisposableStackPrototype.js\tdisposeAsync": keysAreIndexesOrSymbols,
  "engine/DisposableStackPrototype.js\tdispose": keysAreIndexesOrSymbols,
  "engine/IteratorHelpers.js\tperformIteration": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\tcloseAllIterators": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\tconcat": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\tgetIteratorFlattenable": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\tgetIteratorSync": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\titeratorCloseAllNormal": keysAreIndexesOrSymbols,
  "engine/JSIteratorConstructor.js\tzipKeyed": { "property *": ["property zipKeyed"], "finds Function": [] },
  "engine/MapConstructor.js\tgroupBy": keysAreIndexesOrSymbols,
  "engine/ObjectConstructor.js\tgroupBy": readsOnlyItsOwnNewObject,
  "engine/ReflectObject.js\tget": keysAreCountedAtTheCaller,
  "engine/ShadowRealmPrototype.js\timportValue": { "property *": ["global ShadowRealm"], "finds Function": ["global ShadowRealm"] },
  "engine/TypedArrayConstructor.js\tfrom": keysAreIndexesOrSymbols,
  "engine/TypedArrayPrototype.js\tat": keysAreIndexesOrSymbols,
  "engine/TypedArrayPrototype.js\ttoLocaleString": { "*": ["property toLocaleString"] },
};
for (const [key, names] of Object.entries(onBehalfOf)) {
  const id = functionIds.get(key);
  if (id === undefined) throw new Error(`\`onBehalfOf\` names ${key.replace("\t", ": ")}, which is no built-in function`);
  for (const [name, facts] of Object.entries(names)) {
    lines.push(`behalf\t${id}\t${name}\t${facts.join("\t")}`);
  }
}

const handsProcessToTheQueueOfTicks = { "process *": [] };
const onBehalfOfInModules: Record<string, Record<string, string[]>> = {
  "bun/sql": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "bun:sqlite": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/assert/assertion_error": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "internal/cluster/RoundRobinHandle": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/cluster/child": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/cluster/primary": holdsForEveryProperty(neitherCallsNorHandsOutWhatItReads),
  "internal/fifo": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/fixed_queue": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/fs/cp-sync": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/fs/glob": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/fs/streams": {
    ...readsTablesWithoutPrototypeOrByTheirOwnKeys,
    "property *": whereTheProgramTakes(["program-module node:fs", "program-module node:fs/promises"], "createReadStream", "createWriteStream", "ReadStream", "WriteStream", "FileReadStream", "FileWriteStream"),
  },
  "internal/http": handsProcessToTheQueueOfTicks,
  "internal/http/FakeSocket": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/http1_server_fallback": holdsForEveryProperty(neitherCallsNorHandsOutWhatItReads),
  "internal/primordials": { ...holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists), "symbol *": [] },
  "internal/process/pre_execution": holdsForEveryProperty(answersForAProxyWhoseKeysAreCountedAtTheCallerOrReadsItsOwnTables),
  "internal/promisify": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/quic/http2util": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "internal/quic/quic": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "internal/quic/stats": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/readline/emitKeypressEvents": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/readline/interface": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/repl/history": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/repl/node-primordials": holdsForEveryProperty({ "finds Function": ["module node:repl"] }),
  "internal/serialization_buffers": holdsForEveryProperty(neitherCallsNorHandsOutWhatItReads),
  "internal/shared": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/sql/errors": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/sql/options": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "internal/sql/pool": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/sql/postgres": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "internal/sql/shared": neitherCallsNorHandsOutWhatItReads,
  "internal/stream": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/add-abort-signal": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/duplex": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/fast-utf8-stream": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/broadcast": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/classic": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/consumers": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/from": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/pull": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/share": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/iter/transform": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "internal/streams/iter/utils": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/lazy_transform": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/legacy": readsTheTableOfListeners,
  "internal/streams/readable": { ...holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys), ...handsProcessToTheQueueOfTicks },
  "internal/streams/state": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/streams/writable": { ...holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists), ...handsProcessToTheQueueOfTicks },
  "internal/tls": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/trace_events": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "internal/tty": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "internal/util/inspect": {
    "global Buffer": [],
    "native node:buffer": [],
    "regexp computed": [],
    "symbol *": [],
    "property *": whereInspectMayCallGettersOrReadReplacedTables,
    "finds Function": whereAnInspectorOfTheProgramMayReplaceTheStyles,
  },
  "node:_http_agent": { ...neitherCallsNorHandsOutWhatItReads, "property *": whereTheProgramNames("getName") },
  "node:_http_client": { "finds Function": whereTheProgramNames("_defaultAgent", "globalAgent"), "property *": [] },
  "node:_http_common": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:_http_incoming": {
    ...neitherCallsNorHandsOutWhatItReads,
    ...handsProcessToTheQueueOfTicks,
    "property *": whereTheProgramTakes(["module node:_http_incoming"], "_addHeaderLine", "_addHeaderLineDistinct", "_events"),
  },
  "node:_http_outgoing": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "node:_http_server": { ...holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys), ...handsProcessToTheQueueOfTicks },
  "node:_tls_common": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "node:assert": { "finds Function": whereTheProgramNames("constructor") },
  "node:child_process": { ...neitherCallsNorHandsOutWhatItReads, "property *": whereTheProgramTakes(["program-module node:child_process"], "spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork") },
  "node:crypto": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:dgram": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:diagnostics_channel": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:events": { ...readsTheTableOfListeners, "process *": [] },
  "node:http2": holdsForEveryProperty(answersForAProxyWhoseKeysAreCountedAtTheCallerOrReadsItsOwnTables),
  "node:https": holdsForEveryProperty({ "finds Function": whereTheProgramTakes(["program-module node:https"], "_getSession", "_sessionCache") }),
  "node:inspector": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:net": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:os": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:punycode": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:querystring": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "node:readline": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:readline/promises": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:tls": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:url": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "node:util": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "node:v8": holdsForEveryProperty(keysAreSymbolsIndexesOrOfFixedLists),
  "node:wasi": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "node:worker_threads": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "node:zlib": holdsForEveryProperty(readsPlainObjectsAndFixedLists),
  "thirdparty/node-fetch": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
  "thirdparty/ws": holdsForEveryProperty(readsTablesWithoutPrototypeOrByTheirOwnKeys),
};
for (const [specifier, names] of Object.entries(onBehalfOfInModules)) {
  for (const [name, facts] of Object.entries(names)) {
    lines.push(`behalf-module\t${resolve(specifier, "")}\t${name}\t${facts.join("\t")}`);
  }
}

const standardOutput = ["process stdout", "process stderr", "console _stdout", "console _stderr"];
const standardInput = ["process stdin", "process openStdin"];
const bundlerPlugins = ["Bun build", "Bun plugin", "loader html"];
const nodeModule = ["native node:module"];
const requireFunction = ["global require", "global module", ...nodeModule];
const printedObjects = ["Bun inspect", "Bun jest", "console *", "native bun:test", "prints object", "symbol nodejs.util.inspect.custom"];
const channel = [
  "process send",
  "process channel",
  "process disconnect",
  "process connected",
  "process on:message",
  "process on:disconnect",
  "Bun spawn",
  "module node:child_process",
  "module node:cluster",
];
const rootsMadeFor: Record<string, string[]> = {
  "internal/util/inspect": printedObjects,
  "node:path": [],
  "node:timers/promises": ["value setTimeout", "value setInterval", "value setImmediate", "symbol nodejs.util.promisify.custom"],
  "Bake.ts\trenderRoutesForProdStatic": ["Bun build"],
  "BundlerPlugin.ts\tloadAndResolvePluginsForServe": bundlerPlugins,
  "BundlerPlugin.ts\trunOnEndCallbacks": bundlerPlugins,
  "BundlerPlugin.ts\trunOnLoadPlugins": bundlerPlugins,
  "BundlerPlugin.ts\trunOnResolvePlugins": bundlerPlugins,
  "BundlerPlugin.ts\trunSetupFunction": bundlerPlugins,
  "CommonJS.ts\tcreateRequireCache": requireFunction,
  "CommonJS.ts\tgetWrapperArrayProxy": nodeModule,
  "CommonJS.ts\tinternalRequire": requireFunction,
  "CommonJS.ts\tloadEsmIntoCjs": requireFunction,
  "CommonJS.ts\tmain": requireFunction,
  "CommonJS.ts\toverridableRequire": requireFunction,
  "CommonJS.ts\trequire": requireFunction,
  "CommonJS.ts\trequireESM": requireFunction,
  "CommonJS.ts\trequireESMFromHijackedExtension": nodeModule,
  "CommonJS.ts\trequireResolve": requireFunction,
  "ConsoleObject.ts\tasyncIterator": ["console *"],
  "ConsoleObject.ts\tcreateConsoleConstructor": ["console Console"],
  "ConsoleObject.ts\twrite": ["console write"],
  "Fifo.ts\tcreateFIFO": ["module node:fs/promises"],
  "Glob.ts\tscan": ["Bun Glob"],
  "Glob.ts\tscanSync": ["Bun Glob"],
  "Ipc.ts\tparseHandle": channel,
  "Ipc.ts\trestoreAdvancedBuffers": channel,
  "Ipc.ts\tserialize": channel,
  "Ipc.ts\ttagAdvancedBuffers": channel,
  "NodeModuleObject.ts\t_initPaths": nodeModule,
  "Peek.ts\tpeek": ["Bun peek"],
  "Peek.ts\tpeekStatus": ["Bun peek"],
  "ProcessObjectInternals.ts\tbuildAllowedNodeEnvironmentFlags": ["process allowedNodeEnvironmentFlags"],
  "ProcessObjectInternals.ts\tcreateProcessFinalization": ["process finalization"],
  "ProcessObjectInternals.ts\tgetChannel": ["process channel"],
  "ProcessObjectInternals.ts\tgetNodeWorkerStdioStream": [...standardOutput, ...standardInput],
  "ProcessObjectInternals.ts\tgetStdinStream": standardInput,
  "ProcessObjectInternals.ts\tgetStdioWriteStream": [...standardOutput, "module node:events"],
  "ProcessObjectInternals.ts\tloadEnvFile": ["process loadEnvFile"],
  "ProcessObjectInternals.ts\trawDebug": ["process _rawDebug"],
  "UtilInspect.ts\tgetStylizeWithColor": [...printedObjects, "module internal:util/inspect"],
  "UtilInspect.ts\tstylizeWithNoColor": [...printedObjects, "module internal:util/inspect"],
  "WasmStreaming.ts\tconsumeStream": ["global WebAssembly"],
  "shell.ts\tcreateBunShellTemplateFunction": ["Bun $"],
};
for (const [key, facts] of Object.entries(rootsMadeFor)) {
  const id = key.includes("\t") ? functionIds.get(key) : resolve(key, "");
  if (id === undefined) throw new Error(`\`rootsMadeFor\` names ${key.replace("\t", ": ")}, which is no built-in function`);
  lines.push(["root", key.includes("\t") ? "function" : "module", id, ...facts].join("\t"));
}

for (const [property, specifiers] of Object.entries(triggers)) {
  lines.push(`trigger\t${property}\t${idsOf(specifiers).join("\t")}`);
}

const rows = fs
  .readFileSync(path.join(import.meta.dir, "../aot/build/intrinsics.txt"), "utf8")
  .split("\n")
  .filter(line => line)
  .map(line => line.split("\t"));
const rowKey = (name: string, position: string) => `${name}\t${position}`;
const unused = new Set(rows.filter(row => row[2] !== "hardened").map(([name, position]) => rowKey(name, position)));
const plain = new Set(rows.filter(([name]) => !name.endsWith("*")).map(([name, position]) => rowKey(name, position)));
const prefixes = rows.filter(([name]) => name.endsWith("*")).map(([name, position]) => [name.slice(0, -1), position]);
const failures: string[] = [];
for (const use of census([...sourceFiles, ...functionFiles].map(locate))) {
  const key = rowKey(use.name, use.position);
  const prefix = prefixes.find(([prefix, position]) => position === use.position && use.name.startsWith(prefix));
  if (plain.has(key)) unused.delete(key);
  else if (prefix) unused.delete(rowKey(prefix[0] + "*", prefix[1]));
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
  const files = [...sourceFiles, ...functionFiles, "builtins.d.ts", "private.d.ts"].map((file): [string, Buffer] => [
    file,
    fs.readFileSync(locate(file)),
  ]);
  files.push(["manifest", Buffer.from(manifest)]);
  const table = /BUILTINS_HASH: u32 = 0x([0-9a-f]{8});/.exec(fs.readFileSync(path.join(import.meta.dir, "../aot/builtins_generated.rs"), "utf8"));
  if (!table) throw new Error("src/aot/builtins_generated.rs has no BUILTINS_HASH");
  files.push([`table-${table[1]}`, Buffer.alloc(0)]);
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
