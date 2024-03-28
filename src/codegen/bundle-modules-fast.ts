// This script is run when you change anything in src/js/*
import path from "node:path";
import { idToPublicSpecifierOrEnumName, writeIfChanged } from "./helpers";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";

const EOL = "\n";
const BASE = path.join(import.meta.dir, "../js");
const CMAKE_BUILD_ROOT = process.argv[2];

if (!CMAKE_BUILD_ROOT) {
  console.error("Usage: bun bundle-modules-fast.ts <CMAKE_WORK_DIR>");
  process.exit(1);
}

const CODEGEN_DIR = path.join(CMAKE_BUILD_ROOT, "codegen");

let start = performance.now();
function mark(log: string) {
  const now = performance.now();
  console.log(`${log} (${(now - start).toFixed(0)}ms)`);
  start = now;
}

const {
  //
  moduleList,
  nativeModuleIds,
} = createInternalModuleRegistry(BASE);

// This is a generated enum for zig code (exports.zig)
writeIfChanged(
  path.join(CODEGEN_DIR, "ResolvedSourceTag.zig"),
  `// zig fmt: off
pub const ResolvedSourceTag = enum(u32) {
    // Predefined
    javascript = 0,
    package_json_type_module = 1,
    wasm = 2,
    object = 3,
    file = 4,
    esm = 5,
    json_for_object_loader = 6,

    // Built in modules are loaded through InternalModuleRegistry by numerical ID.
    // In this enum are represented as \`(1 << 9) & id\`
${moduleList.map((id, n) => `    @"${idToPublicSpecifierOrEnumName(id)}" = ${(1 << 9) | n},`).join(EOL)}
    // Native modules run through a different system using ESM registry.
${Object.entries(nativeModuleIds)
  .map(([id, n]) => `    @"${id}" = ${(1 << 10) | n},`)
  .join(EOL)}
};
`,
);

mark("Generate Code");
