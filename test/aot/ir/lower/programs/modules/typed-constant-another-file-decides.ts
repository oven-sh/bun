// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The same in TypeScript: annotated, asserted and merged with a type of the same name.
import limit, { debug, Mode, port, name, cast, type Shape } from "./flags";
import * as flags from "./flags";
import { twice } from "./computed";
const shape: Shape = { port };
const mode: Mode = Mode;
if (debug) await import("./never");
if (flags.debug) await import("./never");
if (port !== 80) await import("./never");
if (twice !== 160) await import("./never");
if ((cast as unknown as number) !== 7) await import("./never");
console.log(shape, mode, name, limit, twice, flags.name.length);

// FILE: computed.ts
import { port } from "./flags";
export const twice = port * 2;

// FILE: flags.ts
export interface Shape {
  port: number;
}
export const debug: boolean = false;
export const Mode = "fast";
export type Mode = typeof Mode;
export const port = 80 as const;
export const name = "server" satisfies string;
export const cast = 7 as unknown as string;
const limit: number = 10;
export default limit;

// FILE: never.ts
console.log("never runs");
export {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
