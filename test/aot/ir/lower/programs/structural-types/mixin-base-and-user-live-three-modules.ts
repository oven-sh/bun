// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

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

// GENERATED: Local
// CHECK-LABEL: function {{*}}name="Local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
