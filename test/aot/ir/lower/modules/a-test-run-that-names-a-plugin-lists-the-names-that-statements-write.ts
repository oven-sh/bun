// A plugin answers for a name as it is written, also for a name that exists. A statement is bound at the build and reads the variables of its exporter, so nothing at the link can turn it to the module
// of the plugin. In a test run that names Bun.plugin the record of a file lists the names that its statements write: the run time asks the host about them before it links the file, and where a plugin
// may answer for one of them, the loader of the host links the file. A call asks the loader where it stands, and is not listed.
// RUN: link
// OPTIONS: runs-tests
// DIAGNOSTIC: TS100079 1
// CHECK-COUNT-2: namesOfStatements=
// CHECK-NOT: namesOfStatements=

// RUN(MAIN): link
// MAIN: module {{*}}path="{{*}}/main.ts"{{*}} namesOfStatements=["./helper.ts"]

// RUN(HELPER): link
// HELPER: module {{*}}path="{{*}}/helper.ts"{{*}} namesOfStatements=["./leaf.ts", "./other.ts", "node:os"]

// FILE: main.ts
import { seen } from "./helper.ts";
Bun.plugin({ name: "swap", setup() {} });
console.log(seen(), import("./late.ts"));

// FILE: helper.ts
import { leaf } from "./leaf.ts";
export * from "./other.ts";
export { leaf as again } from "./leaf.ts";
import os from "node:os";
export const seen = () => leaf + typeof os;

// FILE: late.ts
export const late = require("./leaf.ts");

// FILE: leaf.ts
export const leaf = "leaf";

// FILE: other.ts
export const other = "other";
