// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[read]] = GetModuleVariable
// CHECK-NEXT: [[first]] = CheckInitialized [[read]] name="first"
// CHECK-NEXT: = Convert [[first]] declared={type=number}

// Nobody compares the type of the import with the annotation: the program builds, and the path is converted to what is written.

// FILE: main.ts
import first from "./first.bin" with { type: "file" }; // @ts-expect-error
const size: number = first;
console.log(size);

// FILE: first.bin
the first asset
