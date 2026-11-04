// RUN: lower
// OPTIONS: builtin-modules

// `{} as T`: the object is none of the layouts that the type argument names, and the caller goes on as if it were.
interface Options {
  start?: number;
  end?: number;
  name?: string;
  flag?: boolean;
}

interface Point {
  x: number;
  y: number;
}

function copy<T extends object>(source: T): T {
  const target = {} as T;
  for (const key in source) target[key] = source[key];
  return target;
}

function blank<T>(): T {
  return {} as T;
}

function fill<T extends object>(target: T, source: Partial<T>): T {
  return Object.assign(target, source);
}

function describe(options: Options): string {
  const { start, end = Infinity, name, flag } = copy(options);
  return [start, end, name, flag].map(String).join(",");
}

function run(turn: number): string {
  const point = copy<Point>({ x: turn, y: 2 });
  point.x += 1;
  const empty = blank<Point>();
  const filled = fill(blank<Point>(), { y: turn });
  const lines: unknown[] = [
    describe({}),
    describe({ start: turn }),
    describe({ start: 1, end: 2, name: "n", flag: true }),
    point.x + point.y,
    Object.keys(point).join(),
    empty.x,
    typeof empty.y,
    "x" in empty,
    filled.x,
    filled.y + 1,
    Object.keys(copy(Object.create({ inherited: 1 }) as { inherited: number })).join(),
  ];
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(turn));

// GENERATED: copy fill describe
// CHECK-LABEL: function {{*}}name="copy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v3 = ForInOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = ForInStep v3, v0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = ElemGet v0, v7
// CHECK-NEXT: ElemSet v2, v7, v8
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fill"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v4 = Call v3, v2, v0, v1 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="copy"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = NewRuntimeError runtimeError=NotDestructurable name="start"
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = PropGet v7 key="start"
// CHECK-NEXT: v9 = PropGet v7 key="end"
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = Double number=Infinity
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = PropGet v7 key="name"
// CHECK-NEXT: v16 = PropGet v7 key="flag"
// CHECK-NEXT: v17 = NewArray v8, v14, v15, v16 contents=anything
// CHECK-NEXT: v18 = PropGet v17 key="map"
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="map" calleeName="map"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v22 = PropGet v21 key="join"
// CHECK-NEXT: v23 = String string=","
// CHECK-NEXT: v24 = Call v22, v21, v23 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v24 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
