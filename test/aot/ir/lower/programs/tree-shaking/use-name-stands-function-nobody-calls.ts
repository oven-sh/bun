// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_1]]
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="used"
// CHECK-NEXT: v11 = Call v10 calleeName="used"
// CHECK-NEXT: v12 = Call v8, v6, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverImported"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="helper"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="constant"
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="onlyInUnusedBody"
// CHECK-NEXT: v8 = Call v7, -, v5 calleeName="onlyInUnusedBody"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="helper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="alsoNeverImported"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: v1 = PropGet v0 key="neverCalled"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="neverCalled" calleeName="holder.neverCalled"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
