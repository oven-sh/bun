// RUN: lower
// STATISTIC: SourceFilesChecked = 2

// strictPropertyInitialization is a rule of style: a field that nothing initializes stops no build, whatever the project of its class says.

// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = Construct {{*}}calleeName="Box"

// FILE: lenient/other.ts
import { Box } from "../lib/box";
console.log(new Box().set(1).value);

// FILE: lenient/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"strictPropertyInitialization":false}}

// FILE: lib/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: lib/box.ts
export class Box {
  value: number;
  set(value: number) { this.value = value; return this; }
}
