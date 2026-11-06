// RUN: lower
// OPTIONS: builtin-modules

// One object made by generic code is read through two instantiations of the same generic record, neither of which is narrower than the other.
// The value fits both, so both reads are accepted, in either order.
function row(name: string, f: () => unknown): void {
  let said: string;
  try {
    said = JSON.stringify(f());
  } catch (e) {
    said = "threw " + (e as Error).name;
  }
  console.log(name + ": " + said);
}

type Served<Cause, Result> = { cause: Cause; result: Result; number: number };
type ByCause = Served<"poll", string>;
type ByResult = Served<string, "status">;

function nested<C, R>(cause: C, result: R): { served: Served<C, R>; n: number } {
  return { served: { cause, result, number: 2 }, n: 0 };
}
const useCause = (s: ByCause): string => s.cause + ":" + s.result.length + s.number;
const useResult = (s: ByResult): string => s.cause.length + ":" + s.result + s.number;

row("by cause, then by result", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useCause(a.served), useResult(b.served)];
});
row("by result, then by cause", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useResult(b.served), useCause(a.served)];
});
row("back and forth on the same object", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useCause(a.served), useResult(b.served), useCause(a.served), useResult(b.served), a.served === (b.served as unknown), Object.keys(u.served).join()];
});
row("a store through one is seen through the other", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  a.served.number = 7;
  b.served.number += 1;
  return [useCause(a.served), useResult(b.served), u.served.number];
});
row("in a loop", () => {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const u = nested<"poll", "status">("poll", "status");
    const a: { served: ByCause } = u, b: { served: ByResult } = u;
    out.push(i % 2 ? useCause(a.served) + useResult(b.served) : useResult(b.served) + useCause(a.served));
  }
  return out;
});
row("only by cause", () => {
  const u = nested<"poll", string>("poll", "anything");
  const a: { served: ByCause } = u;
  return [useCause(a.served), useCause(a.served)];
});

// GENERATED: nested row useCause
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|[[L_3]] site=[[w_4]]}] results=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|string|[[L_1]]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Convert v1 declared={type=undefined|null|string|[[L_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = NewObject -, v2, v3, v5 layout=[[L_7]] fields=[0, 2, 1]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: v11 = NewObject -, v8, v10 layout=[[L_5]] fields=[1, 0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = String string="threw "
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_13]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Add v11, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17: undefined|null|string):
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string=": "
// CHECK-NEXT: v24 = Add v0, v23
// CHECK-NEXT: v25 = Add v24, v17
// CHECK-NEXT: v26 = Call v22, v20, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useCause"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="cause"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="result"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_17]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_17]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Add v3, v7
// CHECK-NEXT: v9 = PropGet v0 key="number"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
