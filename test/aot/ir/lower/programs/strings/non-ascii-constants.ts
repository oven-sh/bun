// RUN: lower
// OPTIONS: builtin-modules

// String literals with Latin-1, CJK, emoji and unpaired-surrogate characters, in every string method.
declare const console: { log(...args: unknown[]): void }
const show = (s: unknown) => typeof s === "string" ? JSON.stringify(s) + ":" + s.length + ":" + Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16)).join(".") : String(s)
function values(): string[] { return ["café", "é", "ÿÿ", "→ an arrow", "a → b → c", "日本語のテキスト", "😀", "a😀b😀", "\ud800", "x\ud800y", "\udc00\ud800", "\ud83d", "é→😀\ud800", "ends in é", "é starts", "–—…‘’“”", "\u0000é", "ǅ", "ß", "İ"] }
for (const s of values()) console.log(show(s), show(s.toUpperCase()), show(s.toLowerCase()), s.isWellFormed(), show(s.normalize("NFD")), encodeURIComponent(s.toWellFormed()))
interface K1 { kind: "é"; v: number } interface K2 { kind: "→"; v: number } interface K3 { kind: "😀"; v: number } interface K4 { kind: "plain"; v: number }
type K = K1 | K2 | K3 | K4
function which(k: K): number { return k.kind === "é" ? 1 : k.kind === "→" ? 2 : k.kind === "😀" ? 3 : 4 }
function made(i: number): K { return i === 0 ? { kind: "é", v: i } : i === 1 ? { kind: "→", v: i } : i === 2 ? { kind: "😀", v: i } : { kind: "plain", v: i } }
const ks = [made(0), made(1), made(2), made(3)]
console.log(ks.map(which).join(), ks.map(k => show(k.kind)).join())
function byCase(s: string): string { switch (s) { case "é": return "e acute"; case "→": return "arrow"; case "😀": return "face"; case "\ud800": return "half"; case "日本語": return "three"; default: return "none" } }
console.log(["é", "→", "😀", "\ud800", "日本語", "e", "\ud83d", "日本"].map(byCase).join())
const table: Record<string, number> = { "é": 1, "→": 2, "😀": 3, "日本語": 4, "plain": 5 }
const keys = ["é", "→", "😀", "日本語", "plain", "è", "\ud83d"]
console.log(keys.map(k => table[k]).join(), keys.map(k => k in table).join(), Object.keys(table).map(show).join(), Object.hasOwn(table, "😀"), table["é"] + table["→"])
table["ü"] = 6; table["😀😀"] = 7; delete table["→"]; console.log(JSON.stringify(table))
class C { "é"(): string { return "method é" } get "→"(): string { return "getter →" } static "😀" = "static 😀"; "日本語" = "field 日本語"; #é = "private é"; read(): string { return this.#é } }
const c = new C(); console.log(c["é"](), c["→"], C["😀"], c["日本語"], c.read(), Object.getOwnPropertyNames(C.prototype).map(show).join(), c["é"].name, show(Object.keys(c).join()))
function 関数(): string { return 関数.name } console.log(関数(), show((function ünï() {}).name), show((() => {}).name))
console.log(/é+/.test("caféé"), "a→b→c".split("→").join("|"), "a😀b".replace(/😀/u, "[face]"), "a😀b".replace("😀", "→"), /^[→-⇿]+$/.test("→⇒"), /\p{Script=Han}+/u.exec("x日本語y")?.[0], new RegExp("é|→", "g").source, "é→é".replaceAll("é", "e"), /(?<naïve>é)/.exec("é")?.groups?.["naïve"])
console.log("café".startsWith("caf"), "café".endsWith("é"), "café".includes("fé"), "a→b".indexOf("→"), "😀😀".lastIndexOf("😀"), "é".localeCompare("e"), "é" < "→", "→" < "😀", "é".padStart(3, "→"), "→".repeat(3), "é".at(0), "😀".at(1) === "\ude00", "😀".codePointAt(0), [..."a😀é"].length, "x".concat("é", "→"))
const name = "wörld"; console.log(`héllo ${name} → ${1 + 1} 😀`, ((s: TemplateStringsArray, ...v: unknown[]) => s.map(show).join() + v.join())`é${1}→${2}😀`)
try { throw new TypeError("a message → with é and 😀") } catch (e) { console.log(show((e as Error).message), String(e)) }
try { (undefined as unknown as { é: number }).é } catch (e) { console.log((e as Error).constructor.name) }
console.log(show(Symbol("é→").description), Symbol.for("😀") === Symbol.for("😀"), show(Symbol.keyFor(Symbol.for("日本語"))), new Map([["é", 1], ["→", 2]]).get("→"), new Set(["😀", "é"]).has("😀"), ["é", "→", "😀"].includes("→"), ["é", "→"].indexOf("é"), ["b", "é", "a", "→", "😀"].sort().map(show).join())
console.log(JSON.stringify({ "é": "→", "😀": ["\ud800", "日本語"] }), JSON.parse('{"é":"→"}')["é"], show(decodeURIComponent("%C3%A9")), show(unescape("%u2192")), show(String.fromCodePoint(0x1f600) === "😀"), "é" === "é".normalize(), "é".length + "→".length + "😀".length)

// GENERATED: values C \u{2192} read show
// CHECK-LABEL: function {{*}}name="values"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="\u{2192}"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="getter \u{2192}"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_2]] field=2
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v3 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = String string=":"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = PropGet v3 key="length"
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = String string=":"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v16 = PropGet v3 key="length"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = NewClosure v3 function=[[f_5]]
// CHECK-NEXT: v19 = Builtin builtin=CompilerHelpersArrayFromLength [isNotReadFromHolder]
// CHECK-NEXT: v20 = Call v19, -, v16, v18
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v22 = PropGet v21 key="join"
// CHECK-NEXT: v23 = String string="."
// CHECK-NEXT: v24 = Call v22, v21, v23 calleeKey="join" calleeName="join"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = Add v14, v25
// CHECK-NEXT: Return v26
// CHECK-NEXT: b2(v27):
// CHECK-NEXT: v28 = NarrowByTest v0, v27
// CHECK-NEXT: v29 = Builtin builtin=String
// CHECK-NEXT: v30 = Call v29, -, v28 calleeName="String"
// CHECK-NEXT: ReturnCall v30 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
