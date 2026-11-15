// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
import * as barrel from "./barrel.mjs";
import { old, again } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, old.name, old.make().length, old === again, barrel.old === old);

// FILE: barrel.mjs
import old from "./old.cjs";
export { old, old as again };

// FILE: old.cjs
exports.make = function () {
  return { length: 3, 0: 1 };
};
exports.name = "old";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
