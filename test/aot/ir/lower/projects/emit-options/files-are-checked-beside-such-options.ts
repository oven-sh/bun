// RUN: lower
// DIAGNOSTIC: TS2322 wrong.ts:1

// FILE: wrong.ts
export const wrong: number = "text";

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"inlineSources":true,"sourceRoot":"./src","mapRoot":"./maps","declarationDir":"./types","sourceMap":true,"inlineSourceMap":true,"importsNotUsedAsValues":"error","preserveValueImports":true}}
