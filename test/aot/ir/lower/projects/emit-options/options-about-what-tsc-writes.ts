// RUN: lower

// TS5051, TS5069, TS5053 and TS5023 for these are about what tsc writes.

// FILE: one.ts
export const one: number = 1;

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","types":[],"strict":true,"inlineSources":true,"sourceRoot":"./src","mapRoot":"./maps","declarationDir":"./types","sourceMap":true,"inlineSourceMap":true,"importsNotUsedAsValues":"error","preserveValueImports":true}}
