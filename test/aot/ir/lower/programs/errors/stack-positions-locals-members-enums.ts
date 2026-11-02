// RUN: lower
// OPTIONS: builtin-modules

// Prints where a stack trace places a conversion in the initializer of a local variable that a member of an enum reads.
function fail(): string {
  throw new Error("fail");
}
function pass<T>(value: T): T {
  return value;
}
const inThisFile = /stack-positions-locals-members-enums/;
function placesOf(error: unknown): string[] {
  return String((error as Error).stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /:(\d+:\d+)\)?$/.exec(line)![1]);
}
function show(label: string, run: () => unknown) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("read by a member", () => {
  const length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = length,
  }
  return Kind.First;
});
show("read inside an expression of a member", () => {
  const length = pass(1) + `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = 1,
    Second = pass(length) * 2,
  }
  return Kind.Second;
});
show("stored again", () => {
  let length = 1;
  length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = length,
  }
  return Kind.First;
});
show("read by nobody but the function", () => {
  const length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = 1,
  }
  return Kind.First + length;
});

// GENERATED: fail placesOf show
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="fail"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Error"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="placesOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = PropGet v2 key="stack"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v5 = Call v1, -, v4 calleeName="String"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = PropGet v6 key="split"
// CHECK-NEXT: v8 = String string="\n"
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="split" calleeName="split"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = PropGet v10 key="filter"
// CHECK-NEXT: v12 = NewClosure function=[[f_4]]
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = PropGet v14 key="map"
// CHECK-NEXT: v16 = NewClosure function=[[f_5]]
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="map" calleeName="map"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="| no error"
// CHECK-NEXT: v9 = Call v7, v5, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="|"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v18 = Call v17, -, v10 calleeName="placesOf"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v20 = PropGet v19 key="slice"
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = Integer integer=-2
// CHECK-NEXT: v23 = Call v20, v19, v21, v22 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v25 = PropGet v24 key="join"
// CHECK-NEXT: v26 = String string=" "
// CHECK-NEXT: v27 = Call v25, v24, v26 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Call v15, v13, v0, v16, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
