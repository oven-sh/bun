// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// An enum made of an enum made of an enum that was stored to.
import "./spoil";
import { Made } from "./made";
import { Third } from "./third";

console.log(Made.Three, Made.Four, Third.Eight);

// FILE: base.ts
export enum Base {
  One = 1,
  Two,
}

// FILE: made.ts
import { Base } from "./base";

export enum Made {
  Three = Base.One + Base.Two,
  Four = Three + 1,
}

// FILE: spoil.ts
import { Base } from "./base";

(Base as Record<string, unknown>).One = 100;

// FILE: third.ts
import { Made } from "./made";

export enum Third {
  Eight = Made.Four * 2,
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
