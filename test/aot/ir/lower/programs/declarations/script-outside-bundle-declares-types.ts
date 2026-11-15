// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="sum"

// FILE: main.ts
// A .ts file without import or export is a script unless the project says `moduleDetection: force`: what it declares is global, as for tsc and `bun check`, also where nothing imports it.
const pair: Pair = [
  { x: 1, y: 2 },
  { x: 3, y: 4 },
];
function sum(point: Point): number {
  return point.x + point.y;
}
console.log(sum(pair[0]), sum(pair[1]), typeof BUILD_LABEL);
export {};

// FILE: globals.ts
interface Point {
  x: number;
  y: number;
}
type Pair = [Point, Point];
declare const BUILD_LABEL: string | undefined;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "auto", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [ "main.ts", "globals.ts" ] }
