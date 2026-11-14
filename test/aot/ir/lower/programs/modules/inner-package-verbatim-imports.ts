// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1484 1

// FILE: main.ts
// verbatimModuleSyntax in a package's own tsconfig.json applies to that package, even when the program's tsconfig.json does not set it.
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
