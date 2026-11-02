// the file under a package's aot condition defines its fields whatever the application's tsconfig.json says
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
import { keys } from "fields";
console.log(keys());
