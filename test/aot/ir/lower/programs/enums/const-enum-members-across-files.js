// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// A member of a `const` enum is its value wherever TypeScript names it, whichever file declares the enum, as in tsc and `bun build`. Plain `bun run` reads the object of an imported enum, so it shows what JavaScript stored there.
// The object is still there for JavaScript and for a computed key. A plain enum of another file is read from its object.
import { Kind, Name, Plain } from "./kinds.ts";
import { describe, read, readByKey } from "./reader.ts";
console.log(JSON.stringify(read()), [0, 5, 6, 21, 50].map(describe).join());
Kind.Number = 50;
Name.Left = "changed";
Plain.One = 10;
console.log(JSON.stringify(read()), [0, 5, 6, 21, 50].map(describe).join());
console.log(JSON.stringify([Kind.Number, Name.Left, Plain.One, readByKey("Number"), typeof Kind]));

// FILE: again.ts
export * from "./kinds";
export { Kind as Sort } from "./kinds";

// FILE: kinds.ts
export const enum Kind { Word, Number = 5, Text, Flag = 1 << 4, Both = Number | Flag }
export const enum Name { Left = "left", Right = "right" }
export enum Plain { One = 1, Two = 2 }

// FILE: reader.ts
import { Kind, Name, Plain } from "./kinds";
import { Kind as ThroughStar, Sort } from "./again";
import * as all from "./again";
export function read(): unknown[] { return [Kind.Number, Kind["Text"], ThroughStar.Number, Sort.Both, all.Kind.Flag, Name.Left, Plain.One]; }
export function describe(kind: number): string {
  switch (kind) {
    case Kind.Word: return "word";
    case ThroughStar.Number: return "number";
    case Sort.Text: return "text";
    case all.Kind.Both: return "both";
    default: return "other";
  }
}
export function readByKey(key: string): unknown { return (all as any).Kind[key]; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
