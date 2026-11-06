// RUN: lower
// OPTIONS: builtin-modules

// Plain Bun inlines the `const`s that stand before the first other statement of a scope into the code it visits later. Which statements end that prefix, which values are inlined and what is visited later decide whether an enum member that reads a `const` is a constant: the next implicit value and the reverse key show it.
const first = 5;
const text = "w", sum = first + 10, copy = text;
const rope = "a" + "b";
const filled = `${text}-${first}`;
const called = Math.max(1, 2);
const afterCall = 20;
const { size } = { size: called };
const afterPattern = 30;
let unset: number | undefined;
const afterUnset = 40;
interface Erased {}
type AlsoErased = Erased;
declare const ambient: number;
enum Own { A = 1 }
const afterErased = 50;
const fromEnum = Own.A;
let stored = size;
const afterStored = 60;
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

function readsPrefix() {
  enum E {
    First = first, AfterFirst,
    Text = text,
    Sum = sum, AfterSum,
    Copy = copy,
    Filled = filled,
    AfterCall = afterCall, AfterAfterCall,
    AfterPattern = afterPattern, AfterAfterPattern,
    AfterUnset = afterUnset, AfterAfterUnset,
    AfterErased = afterErased, AfterAfterErased,
    FromEnum = fromEnum, AfterFromEnum,
  }
  return E;
}
row("the prefix of the file", readsPrefix());

function readsVariables() {
  enum E { Rope = rope, AfterStored = afterStored, AfterAfterStored }
  return E;
}
row("a joined string and a constant after the prefix", readsVariables());

function readerAbove() {
  function above() {
    enum E { Below = below, AfterBelow }
    return E;
  }
  const below = 6;
  return above();
}
row("a reader above the constant", readerAbove());

function sameList() {
  const inner = 3;
  enum E { Inner = inner, AfterInner }
  {
    enum Nested { Inner = inner, AfterInner }
    return [E, Nested];
  }
}
row("an enum beside the constant", sameList()[0]);
row("an enum in a block below the constant", sameList()[1]);

function sameStatement() {
  const one = 1, reader = () => {
    enum E { One = one, AfterOne, Two = two, AfterTwo }
    return E;
  }, two = 20;
  return reader();
}
row("a reader between two constants of a statement", sameStatement());

function clauses(selector: number) {
  switch (selector) {
    case 0:
      const early = 2;
    case 1:
      function later() {
        enum E { Early = early, AfterEarly }
        return E;
      }
      const late = 30;
      function own() {
        enum E { Late = late, AfterLate }
        return E;
      }
      return [later(), own()];
  }
  return [];
}
row("a constant of an earlier clause", clauses(1)[0]);
row("a constant after a function of its clause", clauses(1)[1]);

namespace Space {
  const local = 4;
  export const exported = 70;
  export function reads() {
    enum E { Local = local, AfterLocal, Exported = exported, AfterExported }
    return E;
  }
}
row("the prefix of a namespace", Space.reads());
export {};

// GENERATED: readerAbove clauses later own
// CHECK-LABEL: function {{*}}name="readerAbove"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_2]]
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Integer integer=6
// CHECK-NEXT: v4 = Convert v3 declared={type=6 site=[[w_4]]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_2]]
// CHECK-NEXT: v6 = Call v2 calleeName="above"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="clauses"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=undefined|null|Array<undefined|null|object> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_8]]
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_9]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_10]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[f_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Switch v0 cases=[0, 1] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Convert v8 declared={type=2 site=[[w_11]]}
// CHECK-NEXT: PutEnvironmentField v1, v9 layout=[[L_8]]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Integer integer=30
// CHECK-NEXT: v13 = Convert v12 declared={type=30 site=[[w_12]]}
// CHECK-NEXT: PutEnvironmentField v1, v13 layout=[[L_8]] field=1
// CHECK-NEXT: v15 = Call v4 calleeName="later"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|object site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = Call v6 calleeName="own"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|object site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = NewArray v16, v18 contents=undefined|null|object
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|object> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Data data=[[d_15]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Array<undefined|null|object> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|object site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = String string="Early"
// CHECK-NEXT: v3 = Integer integer=3
// CHECK-NEXT: v4 = String string="AfterEarly"
// CHECK-NEXT: v5 = NewObject -, v1, v3 layout=[[L_17]] fields=[0, 1]
// CHECK-NEXT: ElemDefine v5, v1, v2
// CHECK-NEXT: ElemDefine v5, v3, v4
// CHECK-NEXT: v8 = FinishObject v5
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|object site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_19]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_8]] field=1
// CHECK-NEXT: v4 = CheckInitialized v3 name="late"
// CHECK-NEXT: PropSet v2, v4 key="Late"
// CHECK-NEXT: v6 = ToPropertyKey v4
// CHECK-NEXT: v7 = String string="Late"
// CHECK-NEXT: ElemSet v2, v6, v7
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: PropSet v2, v9 key="AfterLate"
// CHECK-NEXT: v11 = String string="AfterLate"
// CHECK-NEXT: PropSet v2, v11 key="undefined"
// CHECK-NEXT: v13 = Convert v2 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
