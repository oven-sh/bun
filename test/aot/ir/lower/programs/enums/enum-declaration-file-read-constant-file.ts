// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Enums of the program are made of constants that a declaration file declares with members of its enums for their values. One of those enums names its own members by a path.
import { least, most } from "./limits.js";
enum Size {
  Small = least,
  Large = most,
}
console.log(Size.Small, Size.Large, Size[Size.Small], Size[Size.Large]);

// FILE: limits.d.ts
export declare enum Lower {
  Least = 1,
}
export declare enum Upper {
  Step = 4,
  Most = Upper.Step << 2,
}
export declare const least = Lower.Least;
export declare const most = Upper.Most;

// FILE: limits.js
export const least = 1;
export const most = 16;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
