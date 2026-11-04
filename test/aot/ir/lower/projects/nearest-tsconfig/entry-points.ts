// RUN: link
// ENTRY: top.ts pkg/middle.ts pkg/test/deep.ts
// STATISTIC: SourceFilesChecked = 3

// Each file breaks the one rule of style that the tsconfig.json nearest to it turns on: noImplicitReturns, noUnusedLocals, noImplicitAny.
// No build reports that. The three files are compiled alike, each with the types that it writes.

// CHECK-COUNT-3: function {{*}}name="smells" {{*}}flags=[IsChecked, HasExplicitName] {{*}}parameters=[{type=boolean}, {type=anything}] results=[{type=anything}]

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":true,"noUnusedLocals":false}}

// FILE: top.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: pkg/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":false,"noImplicitReturns":false,"noUnusedLocals":true}}

// FILE: pkg/middle.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);

// FILE: pkg/test/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"noImplicitAny":true,"noImplicitReturns":false,"noUnusedLocals":false}}

// FILE: pkg/test/deep.ts
export function smells(flag: boolean, loose) {
  const unused = 1;
  if (flag) return 1;
}
smells(true, 1);
