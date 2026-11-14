// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS18055 1
// DIAGNOSTIC: TS2686 1
// DIAGNOSTIC: TS2748 1

// FILE: main.ts
// isolatedModules and allowUmdGlobalAccess apply only to the package whose tsconfig.json sets them: the same code has three errors in strict/ and none in loose/.
import { Color } from "./strict/colors.ts";
import { Shade } from "./loose/shades.ts";
console.log(Color.Red, Shade.Dark);

// FILE: library.d.ts
export const version: string;
export as namespace Library;

// FILE: loose/names.ts
export const dark = "dark";

// FILE: loose/shades.ts
/// <reference path="../other-library.d.ts" />
import { dark } from "./names.ts";
declare const enum Ambient { One = 1 }
export enum Shade { Dark = dark }
export const one = Ambient.One;
export const version = OtherLibrary.version;

// FILE: other-library.d.ts
export const version: string;
export as namespace OtherLibrary;

// FILE: strict/colors.ts
/// <reference path="../library.d.ts" />
import { red } from "./names.ts";
declare const enum Ambient { One = 1 }
export enum Color { Red = red }
export const one = Ambient.One;
export const version = Library.version;

// FILE: strict/names.ts
export const red = "red";

// FILE: loose/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "allowUmdGlobalAccess": true }, "files": [] }

// FILE: strict/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "isolatedModules": true }, "files": [] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
