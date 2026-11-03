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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: v1 = Convert v0 declared={type=5 site=[[w_1]]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_6]]
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="used"
// CHECK-NEXT: v13 = Call v12 calleeName="used"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = Call v10, v8, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverImported"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_9]]}] results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="helper"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="constant"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="onlyInUnusedBody"
// CHECK-NEXT: v10 = Call v9, -, v7 calleeName="onlyInUnusedBody"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=number site=[[w_15]]}}, {declared={type=number site=[[w_10]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="helper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_16]]}] results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="alsoNeverImported"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_18]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_20]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_18]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="neverCalled"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="neverCalled" calleeName="holder.neverCalled"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=number site=[[w_21]]}}, {declared={type=number site=[[w_20]]}}]
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
