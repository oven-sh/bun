// RUN: lower
// OPTIONS: builtin-modules

// A const, let or class that stands directly in a case clause, under closures of the same clause, of other clauses and of the case tests: each reads what plain Bun reads, or throws what plain Bun throws
function attempt(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
function sameClause(k: number, n: number): () => number {
  switch (k) {
    case 0: const a = n + 1; return () => a;
    case 1: return () => -1;
    default: return () => -2;
  }
}
function storedInClause(k: number, n: number): () => number {
  switch (k) {
    case 0: let a = n; a = a * 2; if (n > 1) return (() => () => a) as unknown as () => number; return () => a;
    default: return () => -2;
  }
}
function nextClause(k: number): () => number {
  switch (k) {
    case 0: const a = k + 5;
    case 1: return () => a;
    default: return () => -2;
  }
}
function earlierClause(k: number): (() => number)[] {
  const all: (() => number)[] = [];
  switch (k) {
    case 0: all.push(() => a);
    case 1: const a = k + 7; all.push(() => a);
    case 2: all.push(() => a);
  }
  return all;
}
function beforeDeclaration(k: number): string {
  switch (k) {
    case 0: const early = () => a; const first = attempt(early); const a = k + 3; return first + early();
    default: return "";
  }
}
function inCaseTest(k: unknown): string {
  let kept: () => unknown = () => "none";
  switch (k) {
    case (kept = () => a, 1): const a: unknown[] = [k]; return attempt(kept);
    case 2: return attempt(kept);
    default: return attempt(kept);
  }
}
function storedInLaterClause(k: number): number[] {
  const all: (() => number)[] = [];
  for (const step of [k, 1]) {
    switch (step) {
      case 0: let a = 1; all.push(() => a); a = 2; all.push(() => a); break;
      case 1: all.push(() => 0);
    }
  }
  return all.map(f => f());
}
function sharedAcrossClauses(): number[] {
  const all: (() => number)[] = [];
  switch (0 as number) {
    case 0: let a = 1; all.push(() => a);
    case 1: a = 2; all.push(() => a);
  }
  return all.map(f => f());
}
function hoistedInClause(k: number): string {
  switch (k) {
    case 0: function read() { return a; } const first = attempt(read); const a = k + 4; return first + read();
    default: return "";
  }
}
function inLoop(): number[] {
  const all: (() => number)[] = [];
  for (let i = 0; i < 4; i++) {
    switch (i & 1) {
      case 0: const a = i * 10; all.push(() => a); break;
      case 1: const b = i; all.push(() => b); continue;
    }
  }
  return all.map(f => f());
}
function nestedSwitches(k: number, j: number): () => number {
  switch (k) {
    case 0:
      const a = k + 1;
      switch (j) {
        case 0: const b = j + 2; return () => a + b;
        case 1: return () => a;
      }
      return () => a * 10;
    default: return () => 0;
  }
}
function classInClause(k: number): string {
  switch (k) {
    case 0: class Local { name() { return "local"; } } return (() => new Local().name())();
    case 1: return attempt(() => new Local().name());
    default: return "";
  }
}
console.log(sameClause(0, 1)(), sameClause(1, 1)(), sameClause(2, 1)(), storedInClause(0, 1)(), (storedInClause(0, 2)() as unknown as () => number)(), storedInClause(1, 1)());
console.log(nextClause(0)(), attempt(nextClause(1)), nextClause(2)());
console.log(earlierClause(0).map(f => attempt(f)).join(), earlierClause(1).map(f => attempt(f)).join(), earlierClause(2).map(f => attempt(f)).join());
console.log(beforeDeclaration(0), inCaseTest(1), inCaseTest(2), inCaseTest(3));
console.log(storedInLaterClause(0).join(), sharedAcrossClauses().join(), hoistedInClause(0), hoistedInClause(1));
console.log(inLoop().join(), nestedSwitches(0, 0)(), nestedSwitches(0, 1)(), nestedSwitches(0, 2)(), nestedSwitches(1, 0)(), classInClause(0), classInClause(1));

// GENERATED: attempt classInClause early Local name
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="run"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="constructor"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|function site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="classInClause"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_8]]
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: Switch v0 cases=[0, 1] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = NewClosure function=[[f_9]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_10]]
// CHECK-NEXT: v6 = NewClosure function=[[f_11]]
// CHECK-NEXT: DefineMethod v5, v6 layout=[[L_10]] key="name"
// CHECK-NEXT: v8 = FinishClass v5 layout=[[L_10]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Convert v8 declared={type=[[f_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v1, v10 layout=[[L_8]]
// CHECK-NEXT: v12 = NewClosure v1 function=[[f_12]]
// CHECK-NEXT: v13 = Call v12
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v16 = NewClosure v1 function=[[f_15]]
// CHECK-NEXT: v17 = Call v15, -, v16 calleeName="attempt"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v18 = String string=""
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_17]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: env [[L_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_17]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="a"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Local"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="local"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
