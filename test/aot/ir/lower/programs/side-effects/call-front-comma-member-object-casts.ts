// RUN: lower
// OPTIONS: builtin-modules

// A statement that ends in a member of a built-in object evaluates what stands in front of the member, whatever casts stand around them.
function said(): number {
  console.log("called");
  return 1;
}
(said(), Object.keys) as unknown;
(said(), Object.keys) as typeof Object.keys;
<unknown>(said(), Object.keys);
(said(), Object.keys)!;
(said(), Object.keys) satisfies unknown;
(said(), Object.keys as unknown);
(said() as unknown, Object.keys);
((said(), Object) as typeof Object).keys;
(said(), Object)!.keys;
((said(), Object) satisfies object).keys;
((said(), Math) as any).PI;
void ((said(), Symbol.iterator) as symbol);
for (let turn = 0; turn < 2; turn++, Math.PI as number) console.log("turn", turn);
for (let turn = 0; turn < 2; (turn++, Object.keys)!) console.log("turn", turn);

const anything: any = {};
function ending(f: () => void): void {
  try {
    f();
    console.log("completes");
  } catch (error) {
    console.log("throws", (error as Error).constructor.name);
  }
}
ending(() => {
  (anything.shout(), Object.keys) as unknown;
});
ending(() => {
  (anything.shout(), Object)!.keys;
});
console.log("end");

// GENERATED: said ending
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="called"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_1]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ending"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="completes"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="throws"
// CHECK-NEXT: v16 = Convert v9 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = PropGet v16 key="constructor"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = Call v14, v12, v15, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
