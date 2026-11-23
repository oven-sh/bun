import * as library from "node:child_process";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
console.log(library.spawnSync(process.execPath, ["--version"], { env: { ...process.env, BUN_BE_BUN: "1" } }).status);
