// A mock that comes before a CommonJS file is loaded stands for the whole file, whatever its text stores. So the importers of a file that may be mocked list the names that they
// import from it, and a link looks for them once such a mock is there. The importer of a file that nobody mocks lists nothing.
// RUN: link
// OPTIONS: builtin-modules
// CHECK: module {{*}}displayPath="reads-mocked.mjs" {{*}}requiredNames=[{module=[[face]] name="other" mayBeAbsent=true}]
// CHECK-NOT: module {{*}}displayPath="reads-real.mjs" {{*}}requiredNames
// CHECK: module {{*}}displayPath="hands-on.mjs" {{*}}requiredNames=[{module=[[face]] name="other" mayBeAbsent=true exportName="other" specifier="./mocked.cjs"}]

// FILE: main.mjs
import { mock } from "bun:test";
mock.module("./mocked.cjs", () => ({ kept: 1 }));
console.log(await import("./reads-mocked.mjs"), await import("./reads-real.mjs"), await import("./hands-on.mjs"));

// FILE: mocked.cjs
exports.kept = 1;
exports.other = 2;

// FILE: real.cjs
exports.kept = 1;
exports.other = 2;

// FILE: reads-mocked.mjs
import { other } from "./mocked.cjs";
export const seen = () => other;

// FILE: reads-real.mjs
import { other } from "./real.cjs";
export const seen = () => other;

// FILE: hands-on.mjs
export { other } from "./mocked.cjs";
