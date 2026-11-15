// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// strict/ has a tsconfig.json whose compiler options are not the program's. A constant of the entry point, true because the program starts with it, decides there that an `import()` never runs, so the executable does not hold the file that it names.
import { load, loadOther } from "./strict/loader.ts";

export const IS_MAIN = import.meta.main;

console.log(IS_MAIN, await load(), await loadOther());

// FILE: strict/loaded.ts
export const text: string = "loaded where the entry point starts the program";

// FILE: strict/loader.ts
import { IS_MAIN } from "../main.ts";

export const load = async (): Promise<string> => (IS_MAIN ? "nothing is loaded" : (await import("./never-loaded.ts")).text);
export const loadOther = async (): Promise<string> => (IS_MAIN ? (await import("./loaded.ts")).text : "nothing is loaded");

// FILE: strict/never-loaded.ts
export const text: string = "loaded where another file starts the program";

// FILE: strict/tsconfig.json
{ "compilerOptions": { "strict": true } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
