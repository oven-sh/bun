// RUN: lower
// OPTIONS: builtin-modules

// A hundred records are sorted, searched, summed, grouped and put into sets and maps by a number field whose visible stores are all small integers.
// A few of the records got their number by a store that the build cannot attribute: fractions between the integers, -0 beside 0, integers beyond int32, an infinity.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Rec {
  rank = 0;
  constructor(public name: string) {}
}
function byRank(a: Rec, b: Rec) {
  return a.rank - b.rank;
}
function names(list: Rec[]) {
  return list.map(rec => rec.name).join("");
}
function build(extra: [string, number][]) {
  const list: Rec[] = [];
  for (let i = 0; i < 10; i++) {
    const rec = new Rec(String.fromCharCode(97 + i));
    handOver(rec);
    rec.rank = (i * 7) % 10;
    list.push(rec);
  }
  for (const [name, rank] of extra) {
    const rec = new Rec(name);
    handOver(rec);
    Object.assign(rec, JSON.parse(`{"rank":${rank}}`));
    if (name === "Z") Reflect.set(rec, "rank", -0);
    if (name === "I") Reflect.set(rec, "rank", Infinity);
    list.push(rec);
  }
  return list;
}
function study(list: Rec[]) {
  const sorted = list.slice().sort(byRank);
  const total = list.reduce((sum, rec) => sum + rec.rank, 0);
  const largest = list.reduce((max, rec) => Math.max(max, rec.rank), -Infinity);
  const smallest = list.reduce((min, rec) => Math.min(min, rec.rank), Infinity);
  const distinct = new Set(list.map(rec => rec.rank)).size;
  const groups = Object.entries(Object.groupBy(list, rec => (Number.isInteger(rec.rank) ? (rec.rank | 0) === rec.rank ? "int32" : "integer" : "other"))).map(([group, members]) => group + ":" + names(members!)).join(" ");
  const found = list.find(rec => rec.rank === 3)?.name;
  const zeros = list.filter(rec => rec.rank === 0).map(rec => rec.name + (Object.is(rec.rank, -0) ? "-" : "+")).join("");
  const between = list.filter(rec => rec.rank > 2 && rec.rank < 4).map(rec => rec.name).join("");
  const index = new Map(list.map(rec => [rec.rank, rec.name]));
  return `${names(sorted)} ${exact(total)} ${exact(largest)} ${exact(smallest)} ${distinct} ${groups} ${found} ${zeros} ${between} ${index.get(2.5)} ${index.get(0)} ${index.get(2147483648)} ${index.size}`;
}
let length = 0;
for (let i = 0; i < 300; i++) length += study(build([])).length;
console.log("warm", length);
console.log("integers only:", study(build([])));
console.log("with strangers:", study(build([["P", 2.5], ["Q", 3.5], ["R", 2147483648], ["S", -2147483648], ["T", -2147483645], ["Z", 0], ["U", 1e21], ["V", -0.5]])));
console.log("with an infinity:", study(build([["I", 0], ["W", 4294967296]])));

// GENERATED: exact byRank Rec
// CHECK-LABEL: function {{*}}name="exact"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b7(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectIs
// CHECK-NEXT: v6 = Double number=-0
// CHECK-NEXT: v7 = Call v5, v4, v3, v6 calleeName="Object.is"
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(v3)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = String string="-0"
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = ToString v12
// CHECK-NEXT: v14 = Builtin builtin=Number
// CHECK-NEXT: v15 = Builtin builtin=NumberIsInteger
// CHECK-NEXT: v16 = Call v15, v14, v3 calleeName="Number.isInteger"
// CHECK-NEXT: v17 = Convert v16 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = ToBoolean v17
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = String string=""
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = String string="~"
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = ToString v23
// CHECK-NEXT: v25 = Strcat v13, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v26
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: v28 = NarrowByTest v0, v27
// CHECK-NEXT: v29 = TypeOf v28
// CHECK-NEXT: v30 = ToString v29
// CHECK-NEXT: v31 = String string=":"
// CHECK-NEXT: v32 = Builtin builtin=String
// CHECK-NEXT: v33 = Call v32, -, v28 calleeName="String"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = ToString v34
// CHECK-NEXT: v36 = Strcat v30, v31, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byRank"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = PropGet v0 key="rank"
// CHECK-NEXT: v3 = PropGet v1 key="rank"
// CHECK-NEXT: v4 = Sub v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Rec"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_2]]
// CHECK-NEXT: PropSet v4, v1 key="name"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
