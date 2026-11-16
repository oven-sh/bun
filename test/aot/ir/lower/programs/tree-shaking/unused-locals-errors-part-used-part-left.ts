// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="Base"
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK-LABEL: function {{*}}name="UnusedClass"

// FILE: main.ts
// tsconfig.json turns unused locals into errors. Each constant, class and enum here is used, but only by an exported declaration that nobody imports and that is left out. A build that does not look at what it leaves out must not call them unused.
import { helper } from "./lib";

const inner = 1;
const list = [inner];
class Base {}
enum Kind { A }
const arrow = () => helper();
export const unusedExport = { list, Base, kind: Kind.A, arrow };
export class UnusedClass extends Base { static kind = Kind.A; }

console.log("built and ran");

// FILE: lib.ts
export const helper = () => "helper";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "strict": true, "noUnusedLocals": true } }
