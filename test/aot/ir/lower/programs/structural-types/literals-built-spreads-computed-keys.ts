// RUN: lower
// OPTIONS: builtin-modules

// Literals built from spreads and computed keys keep insertion order.
interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function note<T>(name: string, value: T): T {
  log.push(name);
  return value;
}

function show(label: string, p: Point): void {
  console.log(label + ": " + Object.keys(p).join() + " " + JSON.stringify(p) + " x=" + p.x + " y=" + p.y + " [" + log.join() + "]");
  log.length = 0;
}

const onlyX: Partial<Point> = { x: 10 };
const onlyY: Partial<Point> = { y: 20 };
const none: Partial<Point> = {};
const yx: Point = { y: 200, x: 100 };
const missing: Partial<Point> | undefined = [onlyX][1];
const alsoMissing: Partial<Point> | null = log.length === 0 ? null : onlyX;
const keyX: "x" = "x";
const keyY: "y" = "y";

show("plain", { x: 1, y: 2 });
show("computed keys", { [keyY]: 2, [keyX]: 1 });
show("a computed key first", { [keyY]: 2, x: 1 });
show("an overwritten member keeps its place", { x: 1, y: 2, ...onlyX });
show("the second one overwritten", { x: 1, y: 2, ...onlyY });
show("an empty spread", { x: 1, ...none, y: 2 });
show("a spread first", { ...yx, x: 1 });
show("a spread between", { ...onlyY, ...onlyX, x: 1, y: 2 });
show("two spreads", { ...yx, ...{ x: 1, y: 2 } });
show("a spread of a spread", { ...{ ...yx } });
show("an absent spread adds nothing", { x: 1, ...missing, ...alsoMissing, y: 2 });
show("shorthand", (() => {
  const y = 2;
  const x = 1;
  return { y, x };
})());

show("evaluation order", {
  x: note("x", 1),
  ...note("spread", onlyY),
  y: note("y", 2),
});
show("evaluation order with computed keys", {
  [note("key y", keyY)]: note("value y", 2),
  [note("key x", keyX)]: note("value x", 1),
});

const withGetter = {
  get y(): number {
    log.push("get y");
    return 2;
  },
  x: 1,
};
show("a getter is read when it is spread", { ...withGetter });
const partly: Partial<Point> = withGetter;
show("and between other members", { x: note("x", 0), y: note("y", 0), ...partly });

function build(first: "x" | "y"): Point {
  return first === "x" ? { x: 1, y: 2 } : { y: 2, x: 1 };
}
show("chosen at run time, x", build("x"));
show("chosen at run time, y", build("y"));

function assemble(parts: Partial<Point>[]): Point {
  let result: Point = { x: 0, y: 0 };
  for (const part of parts) result = { ...part, ...result, ...part };
  return result;
}
show("assembled", assemble([onlyY, onlyX]));
show("assembled the other way", assemble([onlyX, onlyY]));

function fromEntries(order: ("x" | "y")[]): Point {
  const made: Partial<Point> = {};
  for (const key of order) made[key] = key === "x" ? 1 : 2;
  return { x: 0, y: 0, ...made };
}
show("defaults first", fromEntries(["y", "x"]));

let total = 0;
for (let i = 0; i < 2000; i++) total += Object.keys({ x: i, y: i, ...none }).length + Object.keys({ ...yx, x: i })[0].length;
console.log("2000 rounds: " + total);
show("then", { ...yx, x: 5 });

const many: Point[] = [];
for (let i = 0; i < 6; i++) many.push(i % 2 === 0 ? { x: i, y: i } : { ...yx, y: i });
console.log("in an array: " + JSON.stringify(many));

export {};

// GENERATED: note build assemble y
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"x"|"y" flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"x"|"y"):
// CHECK-NEXT: v1 = String string="x"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Data data=[[d_4]]
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="assemble"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_5]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|number|string|symbol|bigint|[[L_5]]>):
// CHECK-NEXT: v1 = Data data=[[d_6]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4: undefined|null|[[L_2]]):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v10 = NewObject layout=[[L_2]]
// CHECK-NEXT: CopyDataProperties v10, v8
// CHECK-NEXT: CopyDataProperties v10, v4
// CHECK-NEXT: CopyDataProperties v10, v8
// CHECK-NEXT: v14 = FinishObject v10
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v15)
// CHECK-NEXT: b5() role=IterationCleanup subject=v3:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="get y"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
