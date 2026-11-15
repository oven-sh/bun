// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// A project from before `esModuleInterop`: both options about default imports are false, which TypeScript 7 has removed and plain Bun never read. It imports namespaces and uses `import = require`, and builds.
import * as path from "path";
import * as shapes from "./shapes";
import helper = require("./helper");

console.log(path.basename("/a/b.txt"), path.extname("/a/b.txt"));
console.log(shapes.area({ width: 2, height: 3 }), Object.keys(shapes).sort().join());
console.log(helper.twice(21), typeof helper);

let total = 0;
for (let i = 0; i < 2000; i++) total += shapes.area({ width: i, height: 2 }) + helper.twice(i);
console.log(total);

// FILE: helper.ts
export function twice(n: number): number {
  return n * 2;
}

// FILE: shapes.ts
export interface Rectangle {
  width: number;
  height: number;
}
export function area(rectangle: Rectangle): number {
  return rectangle.width * rectangle.height;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "commonjs", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "esModuleInterop": false, "allowSyntheticDefaultImports": false }, "files": [] }
