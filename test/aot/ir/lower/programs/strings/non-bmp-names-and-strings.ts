// RUN: lower
// OPTIONS: builtin-modules

// Property names and strings with characters beyond the Basic Multilingual Plane.
const say: (s: string) => void = (globalThis as any).print ?? console.log
class Holder { "😀" = 1; 𝐀b = 2; "𝐀 method"() { return 3 } static "𝐁" = 4 }
interface Shape { "😀": number; 𝐀b: number; plain: string }
function typed(s: Shape) { return s["😀"] + s.𝐀b + s.plain.length }
function untyped(o: any) { return o["😀"] + o.𝐀b + ("😀" in o ? 10 : 0) + ("😁" in o ? 100 : 0) }
function removed(o: any) { delete o["😀"]; return Object.keys(o).join("|") }
function compared(x: string) { return (x === "𝐀" ? 1 : 0) + (x === "😀😁" ? 2 : 0) + (x.startsWith("𝐀") ? 4 : 0) + (x.endsWith("😁") ? 8 : 0) + (x.includes("😀") ? 16 : 0) }
function switched(x: string) { switch (x) { case "𝐀": return "a"; case "😀😁": return "two"; case "\ud835": return "half"; default: return "other" } }
function built(x: string) { return `<${x}𝐀>` + "😀".length + "𝐀".codePointAt(0) + "😀".charCodeAt(1) }
function keyed(m: Map<string, number>, x: string) { return (m.get("𝐀") ?? -1) + (m.get(x) ?? -2) }
const holder = new Holder()
say([holder["😀"], holder.𝐀b, holder["𝐀 method"](), Holder["𝐁"], Object.keys(holder).join("|")].join(" "))
say(String(typed({ "😀": 5, 𝐀b: 6, plain: "x😀" })))
say(String(untyped({ "😀": 5, 𝐀b: 6 })))
say(removed(Object.fromEntries([["😀", 5], ["𝐀b", 6], ["z", 7]])))
for (const x of ["𝐀", "😀😁", "𝐀😁", "\ud835", "\udc00", "plain"]) say(compared(x) + " " + switched(x) + " " + built(x).length + " " + keyed(new Map([["𝐀", 1], ["😀😁", 2]]), x))
say(JSON.stringify({ "😀": "𝐀", half: "\ud835" }))
say(String(/^[😀-😃]+$/u.test("😁😂")) + " " + "a𝐀b".replace("𝐀", "-") + " " + "a𝐀b".split("𝐀").length + " " + "a𝐀b".indexOf("b"))

// GENERATED: typed removed switched built Holder
// CHECK-LABEL: function {{*}}name="typed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="\u{1f600}"
// CHECK-NEXT: v2 = PropGet v0 key="\u{1d400}b"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="plain"
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="removed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropDelete v1 key="\u{1f600}"
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = PropGet v6 key="join"
// CHECK-NEXT: v8 = String string="|"
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="switched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|"a"|"half"|"other"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["\u{1d400}", "\u{1f600}\u{1f601}", "\u{d835}"] -> case b2(| 0), case b4(| 0), case b6(| 0), otherwise b8()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = String string="a"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"a"|"half"|"other"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = String string="two"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|"a"|"half"|"other"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v8 = String string="half"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|"a"|"half"|"other"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v10 = String string="other"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|"a"|"half"|"other"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="built"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="<"
// CHECK-NEXT: v2 = ToString v0
// CHECK-NEXT: v3 = String string="\u{1d400}>"
// CHECK-NEXT: v4 = Strcat v1, v2, v3
// CHECK-NEXT: v5 = String string="\u{1f600}"
// CHECK-NEXT: v6 = PropGet v5 key="length"
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = String string="\u{1d400}"
// CHECK-NEXT: v9 = PropGet v8 key="codePointAt"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="codePointAt" calleeName="codePointAt"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: v14 = String string="\u{1f600}"
// CHECK-NEXT: v15 = PropGet v14 key="charCodeAt"
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="charCodeAt" calleeName="charCodeAt"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_13]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = Add v13, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_15]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
