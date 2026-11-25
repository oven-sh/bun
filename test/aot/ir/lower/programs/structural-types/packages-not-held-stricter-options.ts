// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Two packages ship TypeScript that exactOptionalPropertyTypes and strictFunctionTypes would reject. Only the application has these options on, so the packages keep their types.
import { defaults, read, reset } from "exact";
import { handle, visit } from "variance";

const options = { limit: 3, step: 4 };
console.log(read(defaults()), read({ step: 2 }), read(options));
reset(options);
console.log(read(options), Object.keys(options), Object.keys(defaults()));
const rex = { name: "rex", bark: 2 };
console.log(handle(rex), visit(rex));

// FILE: node_modules/exact/index.ts
export interface Options {
  limit?: number;
  step: number;
}
export function defaults(): Options {
  return { limit: undefined, step: 1 };
}
export function reset(options: Options): void {
  options.limit = undefined;
}
export function read(options: Options): number {
  return (options.limit ?? 10) + options.step;
}

// FILE: node_modules/exact/package.json
{ "name": "exact", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: node_modules/variance/index.ts
export interface Animal {
  name: string;
}
export interface Dog extends Animal {
  bark: number;
}
export type Handler = (animal: Animal) => number;
export const handler: Handler = (dog: Dog) => dog.bark;
export function handle(animal: Animal): number {
  return handler(animal);
}
function each<T>(item: T, callback: (item: T) => number): number {
  return callback(item);
}
export function visit(animal: Animal): number {
  return each(animal, (dog: Dog) => dog.bark + 1);
}

// FILE: node_modules/variance/package.json
{ "name": "variance", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: package.json
{ "name": "application" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "exactOptionalPropertyTypes": true }, "files": [] }
