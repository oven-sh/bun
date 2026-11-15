// `const root = fileURLToPath(new URL("..", import.meta.url)); require(path.join(root, name))`: nothing reads a file when an executable runs, so it holds every file that the name may find.
// The same for the folder of what a resolver answers with: `path.dirname(require.resolve("./parts/first.cjs"))`.
// What is no code is left out under a start that names no folder, and the build says so.
// DIAGNOSTIC: TS100089 tests/main.mjs:8
// RUN(ROOT): link
// ROOT: module {{*}}path="{{*}}/beside-the-tests.cjs"
// RUN(PARTS): link
// PARTS: module {{*}}path="{{*}}/parts/second.cjs"

// FILE: tests/main.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const parts = path.dirname(require.resolve("../parts/first.cjs"));
export const load = name => require(path.join(root, name));
export const loadPart = name => require(path.join(parts, name + ".cjs"));
export const clean = name => fs.rmSync(path.join(root, name), { recursive: true, force: true });

// FILE: beside-the-tests.cjs
exports.said = "beside the tests";

// FILE: parts/first.cjs
exports.said = "first";

// FILE: parts/second.cjs
exports.said = "second";
