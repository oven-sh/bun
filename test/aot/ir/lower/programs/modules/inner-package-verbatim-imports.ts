// RUN: lower
// OPTIONS: builtin-modules
// CHECK: [[area]] = CheckInitialized {{*}} name="area"
// CHECK: = Call [[area]], {{*}}calleeName="area"

// FILE: main.ts
// Under verbatimModuleSyntax, which inner/tsconfig.json sets, TypeScript wants `import type` for `Shape`. That is an error of the type checker, and a build reports none.
import { area } from "./inner/index.ts";
console.log(area({ width: 2, height: 3 }));

// FILE: inner/index.ts
import { Shape } from "./shape.ts";
export function area(shape: Shape): number {
  return shape.width * shape.height;
}

// FILE: inner/shape.ts
export interface Shape {
  width: number;
  height: number;
}

// FILE: inner/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "verbatimModuleSyntax": true }, "files": [] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
