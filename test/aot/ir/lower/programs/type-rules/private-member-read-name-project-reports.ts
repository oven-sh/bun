// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// Whether a private member is unused is a question of the file that declares it, under its own tsconfig.json. A read by name in a file of another project, which is checked first because the two import each other, counts there whatever that project reports.
import { Holder } from "./reports/holder";
import { Control } from "./reports/control";

console.log(new Holder().show(), new Control().show());

// FILE: lenient/peek.ts
import type { Holder } from "../reports/holder";

export function peek(holder: Holder): number {
  return holder["hidden"];
}

// FILE: reports/control.ts
import { peekControl } from "./peek-control";

export class Control {
  private hidden = 2;
  show(): number {
    return peekControl(this);
  }
}

// FILE: reports/holder.ts
import { peek } from "../lenient/peek";

export class Holder {
  private hidden = 1;
  show(): number {
    return peek(this);
  }
}

// FILE: reports/peek-control.ts
import type { Control } from "./control";

export function peekControl(control: Control): number {
  return control["hidden"];
}

// FILE: lenient/tsconfig.json
{
  "extends": "../tsconfig.json"
}

// FILE: reports/tsconfig.json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noUnusedLocals": true
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
