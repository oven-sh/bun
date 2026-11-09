// RUN: lower
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 1

// CHECK: function {{*}}name="area" {{*}}parameters=[{type=undefined|null|[[size]] flags=[IsExpected]}] results=[{type=number}]

// Of the files under a tsconfig.json that needs another program, only the one that is compiled is compiled without its types.
// A file that is imported for a type, and a file that nothing imports, are read for what they declare. They have unverified
// types all the same: what they declare is only expected, as the parameter of `area` shows.

// FILE: main.ts
import { value } from "./inner/lib.ts";
import type { Size } from "./inner/sizes.ts";
export function area(size: Size): number {
  return size.width * size.height;
}
(globalThis as any).console.log(value, area({ width: 2, height: 3 }));

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext","dom"]}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"lib":["esnext"]}}

// FILE: inner/lib.ts
export const value = typeof document;

// FILE: inner/sizes.ts
export interface Size {
  width: number;
  height: number;
}

// FILE: inner/nothing-imports-this.ts
export const unused = 1;
