// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Exports that node:fs creates on first use, reached only through a module of the program that exports everything of node:fs again: by a named import and through that module's namespace object.
import { ReadStream, lstatSync } from "./again";
import * as again from "./again";

console.log(typeof ReadStream, typeof lstatSync, lstatSync(".").isDirectory());
console.log(ReadStream === (await import("node:fs")).ReadStream, ReadStream === again.ReadStream);

const key = process.argv.length > 99 ? "x" : "WriteStream";
console.log(typeof (again as any)[key], (again as any)[key] === require("node:fs").WriteStream);
console.log("promises" in again, "default" in again, Object.keys(again).includes("Utf8Stream"));

// FILE: again.ts
export * from "node:fs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
