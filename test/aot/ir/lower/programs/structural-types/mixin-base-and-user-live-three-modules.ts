// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// CHECK-LABEL: function {{*}}name="Local"

// FILE: main.ts
// A mixin its base and its user live in three modules.
import { Point } from "./point.ts";
import { describe } from "./show.ts";
import { Tagged } from "./tagged.ts";

const Made = Tagged(Point);
const made = new Made();
console.log(describe(made));
console.log("tag: " + made.tag + " instance: " + (made instanceof Point));
class Local {
  here = "local";
}
console.log(describe(new (Tagged(Local))()));
console.log(describe(new Made()));

// FILE: point.ts
export class Point {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

// FILE: show.ts
export function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

// FILE: tagged.ts
export function Tagged<T extends object>(Base: new () => T) {
  const Parent: new () => object = Base;
  return class extends Parent {
    tag = "tagged";
  };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
