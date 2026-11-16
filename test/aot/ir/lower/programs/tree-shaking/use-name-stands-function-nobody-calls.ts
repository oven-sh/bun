// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="neverImported"
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-LABEL: function {{*}}name="alsoNeverImported"

// FILE: main.ts
// tsconfig.json turns unused locals, parameters and imports into errors. Each helper, import, private member and parameter here is used, but only inside bodies that nobody calls. A build that does not look into those bodies must not call them unused.
import { used } from "./lib";
import { onlyInUnusedBody, type OnlyAType } from "./lib";

function helper(value: number): number {
  return value + 1;
}
const constant = 5;
class Holder {
  private secret = 1;
  private hidden(): number {
    return this.secret;
  }
  neverCalled(): number {
    return this.hidden();
  }
}
export function neverImported(parameter: number): OnlyAType {
  const local = helper(parameter) + constant;
  return onlyInUnusedBody(local);
}
export const alsoNeverImported = (holder: Holder) => holder.neverCalled();

console.log(used());

// FILE: lib.ts
export type OnlyAType = number;
export function used() { return "used"; }
export function onlyInUnusedBody(value: number): OnlyAType { return value; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "strict": true, "noUnusedLocals": true, "noUnusedParameters": true } }
