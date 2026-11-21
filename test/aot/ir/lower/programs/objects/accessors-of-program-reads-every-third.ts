// RUN: lower
// OPTIONS: builtin-modules

// A board of tides: one function lays a getter for every harbor of a table on an object; each reckons its height by the hour and keeps what it told last. What a table has not is answered by a guard below that counts who asked.
type Harbor = { readonly range: number; readonly late: number };
interface Told { hour: number; height: number }
interface Count { asked: number }
const hours = { now: 5 };
const misses: string[] = [];
function heightAt(harbor: Harbor, hour: number): number {
  const turn = (hour + harbor.late) % 12;
  return turn < 6 ? harbor.range * turn : harbor.range * (12 - turn);
}
function gaugeFor(harbor: Harbor, name: string, told: Map<string, Told>): () => number {
  let last: Told | undefined;
  return () => {
    if (last !== undefined && last.hour === hours.now) return last.height;
    last = { hour: hours.now, height: heightAt(harbor, hours.now) };
    told.set(name, last);
    return last.height;
  };
}
function guardBelow(count: Count): object {
  return new Proxy(Object.create(null), {
    get(_below, name) {
      count.asked++;
      misses.push(String(name));
      return -1;
    },
    has(_below, name) {
      return typeof name === "string" && name.startsWith("Port");
    },
  });
}
function boardOf(table: Record<string, Harbor>, count: Count, told: Map<string, Told>): Record<string, number> {
  const board: Record<string, number> = Object.create(guardBelow(count));
  for (const name of Object.keys(table)) Object.defineProperty(board, name, { get: gaugeFor(table[name]!, name, told), enumerable: true, configurable: true });
  return board;
}
const NORTH = { Ems: { range: 2, late: 0 }, Husum: { range: 3, late: 1 }, Sylt: { range: 1.5, late: 2 }, Wyk: { range: 2.5, late: 2 }, Oland: { range: 2, late: 3 }, Amrum: { range: 2, late: 4 }, Hooge: { range: 3.25, late: 4 } };
const SOUTH = { Brest: { range: 6, late: 7 }, Gijon: { range: 4, late: 9 }, Cadiz: { range: 3, late: 10 }, Faro: { range: 3, late: 11 } };
const told = new Map<string, Told>();
const north: Count = { asked: 0 }, south: Count = { asked: 0 };
const boards = [boardOf(NORTH, north, told), boardOf(SOUTH, south, told), boardOf({ ...SOUTH, ...NORTH }, south, told)];
let sum = 0;
for (let round = 0; round < 4; round++) {
  for (const board of boards) {
    const names = Object.keys(board);
    for (let i = round % 3; i < names.length; i += 3) sum += board[names[i]!]!;
  }
  hours.now += round;
}
Object.defineProperty(boards[1]!, "Faro", { value: 100 });
console.log(sum, told.size, boards[1]!.Faro, boards[0]!.Nowhere, "Portland" in boards[0]!, "Lisbon" in boards[1]!, boards[2]!.Ems);
console.log(north.asked, south.asked, misses.join(), [...told].map(([name, last]) => name + last.hour + ":" + last.height).join(" "));

// GENERATED: gaugeFor guardBelow has boardOf heightAt
// CHECK-LABEL: function {{*}}name="heightAt"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="late"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Integer integer=12
// CHECK-NEXT: v5 = Mod v3, v4
// CHECK-NEXT: v6 = Integer integer=6
// CHECK-NEXT: v7 = Less v5, v6
// CHECK-NEXT: Branch v7 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = PropGet v0 key="range"
// CHECK-NEXT: v9 = Mul v8, v5
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = PropGet v0 key="range"
// CHECK-NEXT: v11 = Integer integer=12
// CHECK-NEXT: v12 = Sub v11, v5
// CHECK-NEXT: v13 = Mul v10, v12
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="gaugeFor"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Map<undefined|null|string, undefined|null|[[L_2]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|string, v2: undefined|null|Map<undefined|null|string, undefined|null|[[L_2]]>):
// CHECK-NEXT: v3 = NewObject layout=[[L_4]]
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[OmitsNull]}
// CHECK-NEXT: PutEnvironmentField v3, v5 layout=[[L_4]]
// CHECK-NEXT: v7 = NewClosure v3, v0, v1, v2 function=[[f_5]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="guardBelow"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeName="Object.create"
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v8 = NewClosure function=[[f_9]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v10 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v10, v7 key="get"
// CHECK-NEXT: PropDefine v10, v9 key="has"
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = Construct v1, -, v5, v13 calleeName="Proxy"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="boardOf"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Map<undefined|null|string, undefined|null|[[L_2]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|[[L_6]], v2: undefined|null|Map<undefined|null|string, undefined|null|[[L_2]]>):
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="guardBelow"
// CHECK-NEXT: v7 = Call v4, v3, v6 calleeName="Object.create"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v0 calleeName="Object.keys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = IteratorOpen v12
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = IteratorResume v13
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=Object
// CHECK-NEXT: v20 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v22 = ElemGet v0, v18
// CHECK-NEXT: v23 = Call v21, -, v22, v18, v2 calleeName="gaugeFor"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v25 = Boolean boolean=true
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|boolean}
// CHECK-NEXT: v27 = Boolean boolean=true
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|boolean}
// CHECK-NEXT: v29 = NewObject layout=[[L_15]]
// CHECK-NEXT: PropDefine v29, v24 key="get"
// CHECK-NEXT: PropDefine v29, v26 key="enumerable"
// CHECK-NEXT: PropDefine v29, v28 key="configurable"
// CHECK-NEXT: v33 = FinishObject v29
// CHECK-NEXT: v34 = Call v20, v19, v8, v18, v33 calleeName="Object.defineProperty"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v13:
// CHECK-NEXT: v36 = CatchException
// CHECK-NEXT: IteratorClose v13 completion=Throw
// CHECK-NEXT: Rethrow v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol):
// CHECK-NEXT: v2 = TypeTest v1 testedType=string
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = PropGet v1 key="startsWith"
// CHECK-NEXT: v6 = String string="Port"
// CHECK-NEXT: v7 = Call v5, v1, v6 calleeKey="startsWith" calleeName="name.startsWith"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=boolean}}]
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
