// `const root = fileURLToPath(new URL("..", import.meta.url)); require(path.join(root, name))`.
// The same for the folder of what a resolver answers with: `path.dirname(require.resolve("./parts/first.cjs"))`.
// A test run has a loader, which reads whatever the name says: no file need be in the program. The root of a tree with an unknown rest behind it names every file of the project,
// and what the run removes below that root would be every file of the program: neither is followed there.
// RUN(TESTS): link
// OPTIONS(TESTS): runs-tests
// TESTS-NOT: beside-the-tests.cjs
// TESTS-NOT: second.cjs
// TESTS: module {{*}}path="{{*}}/tests/main.mjs"
// TESTS-NOT: beside-the-tests.cjs
// TESTS-NOT: second.cjs

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
