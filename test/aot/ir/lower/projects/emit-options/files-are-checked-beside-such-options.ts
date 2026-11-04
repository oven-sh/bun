// RUN: lower
// STATISTIC: SourceFilesChecked = 1

// Beside options about what tsc writes a file counts as checked: the type that is written is sent. That the value does not fit it stops no build.
// CHECK: function {{*}}kind=Module flags=[IsChecked]
// CHECK: [[text]] = String string="text"
// CHECK-NEXT: Convert [[text]] declared={type=number}

// FILE: wrong.ts
export const wrong: number = "text";

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"inlineSources":true,"sourceRoot":"./src","mapRoot":"./maps","declarationDir":"./types","sourceMap":true,"inlineSourceMap":true,"importsNotUsedAsValues":"error","preserveValueImports":true}}
