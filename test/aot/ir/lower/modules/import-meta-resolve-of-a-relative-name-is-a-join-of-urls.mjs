// `import.meta.resolve("./plugins/")` asks no resolver: a name that begins with "./" or "../" is joined to the URL of the file, as `new URL("./plugins/", import.meta.url).href` is.
// A resolver would answer a folder with its index file, and the names that go on behind the answer would find nothing.
// RUN(TEXT): link
// TEXT: module {{*}}path="{{*}}/plugins/first.mjs"
// RUN(PATH): link
// PATH: module {{*}}path="{{*}}/plugins/second.cjs"
// RUN(ABOVE): link
// ABOVE: module {{*}}path="{{*}}/shared/third.mjs"
// A test run has a loader, which reads whatever the name says: nothing is followed there.
// RUN(TESTS): link
// OPTIONS(TESTS): runs-tests
// TESTS-NOT: first.mjs
// TESTS-NOT: second.cjs
// TESTS-NOT: third.mjs

// FILE: app/main.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const base = import.meta.resolve("./plugins/");
const above = import.meta.resolve("../shared/");
export const byText = name => import(base + name + ".mjs");
export const byPath = name => require(path.join(fileURLToPath(base), name + ".cjs"));
export const fromAbove = name => import(above + name + ".mjs");

// FILE: app/plugins/index.mjs
export const said = "index";

// FILE: app/plugins/first.mjs
export const said = "first";

// FILE: app/plugins/second.cjs
exports.said = "second";

// FILE: shared/third.mjs
export const said = "third";
