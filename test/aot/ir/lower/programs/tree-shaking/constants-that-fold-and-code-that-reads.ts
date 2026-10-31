// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Constants whose values a compiler knows: numbers, strings, booleans, sums of others, enum members, constants of another file. The code that reads them may get the value put in place of the name. Each is read in a way that still needs the right value: as a key, in a template, in a switch, as a default, in a closure that runs later, through an export, before its declaration in a function that is called afterwards.
import { REMOTE, REMOTE_SUM, RemoteLevel } from "./constants";
import * as constants from "./constants";

function early() { return [LATE, LATE_SUM, LateLevel.High].join(); }
const ONE = 1;
const TWO = ONE + 1;
const TEXT = "te" + "xt";
const FLAG = !ONE;
const NESTED = { value: TWO };
enum Level { Low = ONE, High = TWO * 2 }
const UNUSED = TWO * 100;
const table = { [ONE]: "one", [TEXT]: "text", [Level.High]: "high" };
const later = () => TWO + REMOTE;
function withDefault(value = TWO, other = REMOTE_SUM) { return value + other; }
function choose(n: number) {
  switch (n) {
    case ONE: return "ONE";
    case TWO: return "TWO";
    case REMOTE: return "REMOTE";
    default: return "none";
  }
}
const LATE = 7;
const LATE_SUM = LATE + ONE;
enum LateLevel { High = LATE * 2 }
export const EXPORTED = TWO + 40;

console.log(table[1], table.text, table[4], `${TWO}${TEXT}${FLAG}`, NESTED.value, later(), withDefault(), choose(1), choose(2), choose(10), choose(3));
console.log(early(), constants.REMOTE, (constants as any)["REMOTE" + "_SUM"], RemoteLevel.Top, constants.RemoteLevel[RemoteLevel.Top], EXPORTED);

// FILE: constants.ts
const BASE = 5;
export const REMOTE = BASE * 2;
export const REMOTE_SUM = REMOTE + BASE;
export const REMOTE_UNUSED = REMOTE_SUM + 1;
export enum RemoteLevel { Top = BASE + 4 }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: early withDefault later
// CHECK-LABEL: function {{*}}name="early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="LATE"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="LATE_SUM"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="High"
// CHECK-NEXT: v7 = Convert v6 declared={type=14 site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = NewArray v1, v3, v7 contents=number
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withDefault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number site=[[w_7]]}, {type=undefined|number site=[[w_8]]}] results=[{type=number site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: undefined|number, v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="TWO"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: v9 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v9 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="REMOTE_SUM"
// CHECK-NEXT: v13 = Convert v12 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v13)
// CHECK-NEXT: b8(v14):
// CHECK-NEXT: Jump -> next b9(v14)
// CHECK-NEXT: b9(v15):
// CHECK-NEXT: v16 = Add v8, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="TWO"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="REMOTE"
// CHECK-NEXT: v4 = Convert v3 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Integer integer=12
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
