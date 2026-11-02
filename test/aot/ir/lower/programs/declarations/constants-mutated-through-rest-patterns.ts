// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The rest element of an assignment pattern stores to its target wherever the pattern stands: behind a hole, in the head of a loop, on an element of a list, through a parameter, through a module namespace. A copy taken by a constant that is declared before the store keeps the old value.
import { shared } from "./shared";
import { storeThroughNamespace } from "./stores";
const behindHole = { rest: [1] };
const copyOfBehindHole = { ...behindHole };
const inLoopHead = { rest: [1] };
const copyOfInLoopHead = { ...inLoopHead };
const list = [[1], [2]];
const copyOfList = [...list];
const handed = { rest: [1] };
const copyOfHanded = { ...handed };
const copyOfShared = { ...shared };
const record: { rest: Record<string, number> } = { rest: { x: 1 } };
const copyOfRecord = { ...record };
function store(into: { rest: number[] }): void { [...into.rest] = [2, 3]; }
function read(): string { return JSON.stringify([copyOfBehindHole, copyOfInLoopHead, copyOfList, copyOfHanded, copyOfShared, copyOfRecord]); }
[, ...behindHole.rest] = [0, 2, 3];
for ([...inLoopHead.rest] of [[2, 3]]) {}
[...list[0]] = [9];
store(handed);
storeThroughNamespace();
({ ...record.rest } = { y: 2 });
console.log(read());

// FILE: shared.ts
export const shared = { rest: [1] };

// FILE: stores.ts
import * as namespace from "./shared";
export function storeThroughNamespace(): void { [...namespace.shared.rest] = [2, 3]; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: store read
// CHECK-LABEL: function {{*}}name="store"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_3]]
// CHECK-NEXT: v2 = IteratorOpen v1 elementCount=0 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b8():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v2 stepIndex=0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v8 = Convert v3 declared={type=undefined|null|Array<number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v0, v8 key="rest"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v2
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: AppendElement v3, v7
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b8() role=IterationCleanup subject=v2:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=JSON
// CHECK-NEXT: v1 = PropGet v0 key="stringify"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="copyOfBehindHole"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="copyOfInLoopHead"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="copyOfList"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="copyOfHanded"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="copyOfShared"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="copyOfRecord"
// CHECK-NEXT: v15 = NewArray v4, v6, v8, v10, v12, v14 contents=anything
// CHECK-NEXT: v16 = Call v2, v0, v15 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
