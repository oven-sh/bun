// RUN: link
// STATISTIC: SourceFilesChecked = 2

// A file of the project outside rootDir is no error, and the rest counts as checked beside it: the type that is written in an imported file is sent. That the value does not fit it stops no build.
// CHECK: module [[wrong]] path="{{*}}/wrong.ts"
// CHECK: function {{*}}module=[[wrong]] kind=Module flags=[IsChecked]
// CHECK: [[text]] = String string="text"
// CHECK-NEXT: Convert [[text]] declared={type=number}

// FILE: src/main.ts
import { wrong } from "./wrong";
export const main = wrong;

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"outDir":"./dist","rootDir":"./src"},"include":["src","test"]}

// FILE: src/wrong.ts
export const wrong: number = "text";

// FILE: test/setup.ts
declare global {
  var marker: number | undefined;
}
export {};
