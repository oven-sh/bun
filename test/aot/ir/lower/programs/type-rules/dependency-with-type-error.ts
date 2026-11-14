// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 0
// STATISTIC: SourceFilesDemoted = 0
// CHECK-LABEL: function {{*}}name="attempt"

// FILE: main.ts
// A package that ships TypeScript is held to the types it wrote, like the program. No build looks for type errors, so a file of a package that has one keeps its tests like the other files, and nothing is reported.
import { half as looseHalf } from "loose-package";
import { half as neighborHalf } from "loose-package/neighbor";
import { half as soundHalf } from "sound-package";

const eight: any = "8";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
attempt("a package without type errors", () => soundHalf(eight));
attempt("a file of a package with a type error", () => looseHalf(eight));
attempt("another file of that package", () => neighborHalf(eight));

// FILE: node_modules/loose-package/index.ts
export const mistyped: number = "text";
export function half(n: number) { return n / 2; }

// FILE: node_modules/loose-package/neighbor.ts
export function half(n: number) { return n / 2; }

// FILE: node_modules/loose-package/package.json
{ "name": "loose-package", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: node_modules/sound-package/index.ts
export function half(n: number) { return n / 2; }

// FILE: node_modules/sound-package/package.json
{ "name": "sound-package", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
