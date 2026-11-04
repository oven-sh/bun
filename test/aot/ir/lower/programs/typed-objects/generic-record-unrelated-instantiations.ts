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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewObject -, v0, v1, v3 layout=[[L_2]] fields=[0, 2, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = NewObject -, v6, v8 layout=[[L_1]] fields=[1, 0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_3]]):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = String string="threw "
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: v14 = Add v11, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16: undefined|null|string):
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string=": "
// CHECK-NEXT: v23 = Add v0, v22
// CHECK-NEXT: v24 = Add v23, v16
// CHECK-NEXT: v25 = Call v21, v19, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="useCause"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="cause"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="result"
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = PropGet v0 key="number"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
