// RUN: lower
// OPTIONS: builtin-modules

// An enum member whose initializer reads a variable or an ambient enum is evaluated where the enum is created, as in plain Bun: its reverse key and the next implicit value follow from that.
declare const console: { log(...values: unknown[]): void };
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}

const base = 5;
const word = "w";
enum FromNumber { A = base, B }
row("a number", FromNumber);
enum FromArithmetic { A = base * 2 + 1, B, C = 1, D }
row("arithmetic", FromArithmetic);
enum FromString { A = word }
row("a string", FromString);
enum FromTemplate { A = `${word}-a`, B = `${word}` }
row("a template", FromTemplate);
enum FromConcatenation { A = word + "-a", B = "a-" + word, C = word + word }
row("a concatenation", FromConcatenation);

enum Local { S = "s", N = 2 }
enum FromLocalEnum { A = Local.S, B = Local.N, C, D = Local.S + word, E = Local.N + base, F }
row("an enum of this file", FromLocalEnum);
enum FromOwnMember { A = "a", B = A + word, C = base, D = C }
row("its own members", FromOwnMember);

declare enum Host { A = 1 }
(globalThis as any).Host = { A: 20 };
enum FromAmbientEnum { B = Host.A, C }
row("an ambient enum", FromAmbientEnum);
declare const hostNumber = 5;
(globalThis as any).hostNumber = 50;
enum FromAmbientConstant { A = hostNumber, B }
row("an ambient constant", FromAmbientConstant);

function inFunction() {
  const inner = 3;
  enum Inner { A = inner, B }
  return Inner;
}
row("in a function", inFunction());

// GENERATED: row inFunction
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v1 calleeName="Object.keys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = PropGet v12 key="map"
// CHECK-NEXT: v14 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="map" calleeName="map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = Call v17, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Add v8, v19
// CHECK-NEXT: v21 = Call v6, v4, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=3
// CHECK-NEXT: v1 = Convert v0 declared={type=3 site=[[w_6]]}
// CHECK-NEXT: v2 = NewObject layout=[[L_7]]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: PropSet v3, v1 key="A"
// CHECK-NEXT: v5 = ToPropertyKey v1
// CHECK-NEXT: v6 = String string="A"
// CHECK-NEXT: ElemSet v3, v5, v6
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: PropSet v3, v8 key="B"
// CHECK-NEXT: v10 = String string="B"
// CHECK-NEXT: PropSet v3, v10 key="undefined"
// CHECK-NEXT: v12 = Convert v3 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
