// RUN: link
// ENTRY: pkg/test/main.ts
// CWD: pkg/test
// STATISTIC: SourceFilesChecked = 4

// No build reports what a tsconfig.json asks of style: see entry-points.ts. Here the files are imported, and the build starts in the innermost folder.

// CHECK-COUNT-3: function {{*}}name="smells" {{*}}flags=[IsChecked, HasExplicitName] {{*}}parameters=[{type=boolean}, {type=anything}] results=[{type=anything}]

// FILE: pkg/test/main.ts
import "../../top";
import "../middle";
import "./deep";

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
