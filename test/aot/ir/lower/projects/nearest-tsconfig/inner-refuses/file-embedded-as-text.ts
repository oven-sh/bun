// RUN: lower
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1
// STATISTIC: SourceFilesDemoted = 1

// The tsconfig.json of the entry point names inner/text.ts as a file of the project, and the program embeds it as text.
// Neither makes it a compiled file: of the two files under a tsconfig.json that needs another program, only the one that is
// imported for its value is compiled without its types.

// FILE: main.ts
import { value } from "./inner/lib.ts";
import text from "./inner/text.ts" with { type: "text" };
(globalThis as any).console.log(value, text.length);

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext","dom"]}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext"]}}

// FILE: inner/lib.ts
export const value = typeof document;

// FILE: inner/text.ts
export const embedded = typeof document;
