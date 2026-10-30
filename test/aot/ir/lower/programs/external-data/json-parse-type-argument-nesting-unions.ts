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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v2 = String string="depth "
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = Call v0, -, v1 calleeName="parse"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="depthOf"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v7 = Add v2, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = String string=": "
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Convert v10 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="message"
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_10]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_15]]|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_15]]|[[L_16]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_15]]|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_15]]|[[L_16]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|[[L_15]]|[[L_16]] site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_15]]|[[L_16]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="afterwards"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_27]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_24]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="text"
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v0 key="text"
// CHECK-NEXT: v6 = Integer integer=3
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="replace"
// CHECK-NEXT: v10 = NewRegExp pattern="[\\]}]$"
// CHECK-NEXT: v11 = String string=""
// CHECK-NEXT: v12 = Call v9, v8, v10, v11 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_29]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = PropGet v0 key="text"
// CHECK-NEXT: v15 = Integer integer=3
// CHECK-NEXT: v16 = Call v14, v0, v15 calleeKey="text" calleeName="road.text"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_30]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = PropGet v17 key="replace"
// CHECK-NEXT: v19 = NewRegExp pattern="null|\\{\\}|\\[\\]|\"leaf\"|\"last\"|1"
// CHECK-NEXT: v20 = String string="false"
// CHECK-NEXT: v21 = Call v18, v17, v19, v20 calleeKey="replace" calleeName="replace"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_30]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = String string="{\"x\":1,\"y\":2}"
// CHECK-NEXT: v24 = String string="[]"
// CHECK-NEXT: v25 = NewArray v4, v13, v22, v23, v24 contents=undefined|null|string
// CHECK-NEXT: v26 = PropGet v25 key="map"
// CHECK-NEXT: v27 = NewClosure v0 function=[[f_31]]
// CHECK-NEXT: v28 = Call v26, v25, v27 calleeKey="map" calleeName="map"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array<undefined|null|string> site=[[w_32]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v30 = PropGet v29 key="join"
// CHECK-NEXT: v31 = String string="; "
// CHECK-NEXT: v32 = Call v30, v29, v31 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v32 casts=[{declared={type=undefined|null|string site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
