// A mock that stands in place of a built-in module has its own names alone. The build has found `EOL` in the table of built-ins, and the link of each importer looks whether a mock has left it out.
// OPTIONS: builtin-modules
// RUN(IMPORT): link
// IMPORT: module {{*}}displayPath="reader.ts" {{*}}requiredNames=[{module=[[os]] name="EOL" mayBeAbsent=true}]

// RUN(EXPORT): link
// EXPORT: module {{*}}displayPath="hands-on.ts" {{*}}requiredNames=[{module=[[os]] name="EOL" mayBeAbsent=true exportName="end" specifier="node:os"}]

// `os.EOL` is `undefined` where the mock has no `EOL`.
// RUN(NAMESPACE): link
// NAMESPACE: module {{*}}displayPath="reader-of-the-namespace.ts"
// NAMESPACE-NOT: requiredNames
// NAMESPACE: module

// FILE: main.ts
import { mock } from "bun:test";
mock.module("node:os", () => ({}));
console.log(await import("./reader"), await import("./hands-on"), await import("./reader-of-the-namespace"));

// FILE: reader.ts
import { EOL } from "node:os";
console.log(EOL);

// FILE: hands-on.ts
export { EOL as end } from "node:os";

// FILE: reader-of-the-namespace.ts
import * as os from "node:os";
console.log(os.EOL);
