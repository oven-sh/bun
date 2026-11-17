// RUN: lower

// The checker finds the file as Bun does: what is written `typeof value` is the number that the file declares. A name that it does not find gives no Convert.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: CheckInitialized {{*}}name="value"
// CHECK-NEXT: [[value]] = Integer integer=1
// CHECK-NEXT: = Convert [[value]] declared={type=number}

// FILE: main.ts
import { value } from "./src/value";
const copy: typeof value = value;
console.log(copy);

// FILE: package.json
{"name":"under-node16","type":"module"}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ES2023","module":"Node16","moduleResolution":"Node16","noEmit":true,"types":[],"strict":true}}

// FILE: src/value.ts
export const value: number = 1;

// FILE: src/folder/index.ts
export const inFolder: string = "folder";
