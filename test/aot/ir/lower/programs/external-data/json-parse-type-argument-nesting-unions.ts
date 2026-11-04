// RUN: lower
// OPTIONS: builtin-modules

// Texts nested 100 to 1,000,000 levels deep through tagged unions and past undeclared keys, at the top of the stack and near its end: `JSON.parse(text) as T` gives the value or a RangeError, nothing else, and goes on working afterwards.
type Tree = { kids: Tree[] };
type Chain = { next: Chain | null };
type Link = { name: string; next?: Link };
type Deep = Deep[];
type Bag = { [key: string]: Bag };
type Pair = [Pair] | [];
type Either = { kind: "leaf" } | { kind: "node"; below: Either };
type Loose = { value: unknown };
type Any = { value: any };
type Point = { x: number; y: number };

type Road = { label: string; parse: (text: string) => unknown; text: (levels: number) => string; depth: (levels: number) => number };
const roads: Road[] = [
  { label: "records in another order, with undeclared keys", parse: text => JSON.parse(text) as Link, text: levels => '{"other":1,"next":'.repeat(levels) + '{"name":"last"}' + ',"name":"n"}'.repeat(levels), depth: levels => levels + 1 },
  { label: "a tagged union", parse: text => JSON.parse(text) as Either, text: levels => '{"kind":"node","below":'.repeat(levels) + '{"kind":"leaf"}' + "}".repeat(levels), depth: levels => levels + 1 },
  { label: "a tagged union, the tag last", parse: text => JSON.parse(text) as Either, text: levels => '{"below":'.repeat(levels) + '{"kind":"leaf"}' + ',"kind":"node"}'.repeat(levels), depth: levels => levels + 1 },
];

function depthOf(value: any): number {
  let depth = 0;
  while (typeof value === "object" && value !== null) {
    depth++;
    let next: any = undefined;
    for (const key in value) if (typeof value[key] === "object") next = value[key];
    value = next;
  }
  return depth;
}

function answer(parse: (text: string) => unknown, text: string): string {
  try {
    return "depth " + depthOf(parse(text));
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

const overflow = "RangeError: Maximum call stack size exceeded.";
const afterwards = (road: Road) => [road.text(3), road.text(3).replace(/[\]}]$/, ""), road.text(3).replace(/null|\{\}|\[\]|"leaf"|"last"|1/, "false"), '{"x":1,"y":2}', "[]"].map(text => answer(road.parse, text)).join("; ");

for (const road of roads) {
  const before = afterwards(road);
  let wrong = 0;
  let changed = 0;
  const ask = (levels: number): boolean => {
    const said = answer(road.parse, road.text(levels));
    if (said !== overflow && said !== "depth " + road.depth(levels)) wrong++;
    if (afterwards(road) !== before) changed++;
    return said === overflow;
  };
  for (const levels of [100, 10_000, 1_000_000]) ask(levels);
  let high = 1000;
  while (high < 1_000_000 && !ask(high)) high *= 2;
  if (high < 1_000_000) {
    let low = high / 2;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (ask(middle)) high = middle;
      else low = middle;
    }
    for (let levels = high - 300; levels < high + 300; levels += 67) ask(levels);
    for (let levels = high - 3; levels < high + 3; levels++) ask(levels);
  }

  const cut = road.text(1_000_000).slice(0, 1_000_000);
  if (answer(road.parse, cut) !== answer(globalThis.JSON.parse, cut)) wrong++;

  const depths = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];
  const texts = depths.map(road.text);
  let frames = 0;
  let values = 0;
  const dive = (level: number): void => {
    try {
      dive(level + 1);
    } catch {
      if (frames === 0) frames = level;
    }
    if (frames - level > 3000) return;
    const which = level % depths.length;
    const said = answer(road.parse, texts[which]);
    if (said === "depth " + road.depth(depths[which])) values++;
    else if (said !== overflow) wrong++;
  };
  dive(0);
  if (afterwards(road) !== before) changed++;
  console.log(road.label + ": " + wrong + " answers are neither the value nor a RangeError, " + changed + " times it went on otherwise than before, " + (values > 0 ? "some" : "NO") + " values near the end of the stack");
}

// GENERATED: answer parse afterwards
// CHECK-LABEL: function {{*}}name="answer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = String string="depth "
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Call v0, -, v1 calleeName="parse"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="depthOf"
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = String string=": "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = PropGet v8 key="message"
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse" expectedResult=x0
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_4]]|[[L_5]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_4]]|[[L_5]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="afterwards"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: v1 = PropGet v0 key="text"
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v4 = PropGet v0 key="text"
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v7 = PropGet v6 key="replace"
// CHECK-NEXT: v8 = NewRegExp pattern="[\\]}]$"
// CHECK-NEXT: v9 = String string=""
// CHECK-NEXT: v10 = Call v7, v6, v8, v9 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = PropGet v0 key="text"
// CHECK-NEXT: v13 = Integer integer=3
// CHECK-NEXT: v14 = Call v12, v0, v13 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v15 = PropGet v14 key="replace"
// CHECK-NEXT: v16 = NewRegExp pattern="null|\\{\\}|\\[\\]|\"leaf\"|\"last\"|1"
// CHECK-NEXT: v17 = String string="false"
// CHECK-NEXT: v18 = Call v15, v14, v16, v17 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = String string="{\"x\":1,\"y\":2}"
// CHECK-NEXT: v21 = String string="[]"
// CHECK-NEXT: v22 = NewArray v3, v11, v19, v20, v21 contents=anything
// CHECK-NEXT: v23 = PropGet v22 key="map"
// CHECK-NEXT: v24 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="map" calleeName="map"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v27 = PropGet v26 key="join"
// CHECK-NEXT: v28 = String string="; "
// CHECK-NEXT: v29 = Call v27, v26, v28 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v29 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
