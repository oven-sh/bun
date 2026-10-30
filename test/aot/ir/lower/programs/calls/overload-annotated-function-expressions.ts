// RUN: lower
// OPTIONS: builtin-modules

// A function expression annotated with a type that has several call signatures returns what each of them promises, not what the first one does.
type Cookie = Record<string, string>
interface GetCookie { (header: string, key: string): string | undefined; (header: string): Cookie }
function parse(header: string): Cookie { const all: Cookie = {}; for (const pair of header.split("; ")) { const at = pair.indexOf("="); all[pair.slice(0, at)] = pair.slice(at + 1) } return all }
const getCookie: GetCookie = (header, key?) => { const all = parse(header); if (typeof key === "string") return all[key]; return all as any }
console.log(getCookie("session=8d1f; theme=dark", "theme"), JSON.stringify(getCookie("session=8d1f; theme=dark")))
interface Point { x: number; y: number }
interface Convert { (text: string): number; (n: number): string; (p: Point): Point }
const convert: Convert = (value: any): any => typeof value === "string" ? value.length + 0.5 : typeof value === "number" ? "n" + value : { x: value.y, y: value.x }
const unannotated: Convert = ((value: string | number | Point) => typeof value === "string" ? value.length + 0.5 : typeof value === "number" ? "n" + value : { x: value.y, y: value.x }) as Convert
console.log(convert("abc"), convert(2), convert({ x: 1.5, y: 2.5 }).x, unannotated("abc"), unannotated(2), unannotated({ x: 1.5, y: 2.5 }).y)
const table: { pick: { (i: number): number; (k: string): string } } = { pick: (k: any) => k }
console.log(table.pick(1.5), table.pick("k"))
function run(f: { (a: number): number; (a: string): boolean }) { return [f(1.5), f("s")].join() }
console.log(run((a: any): any => typeof a === "number" ? a * 2 : a === "s"))
class Box { get: { (): number; (fallback: string): string } = (fallback?: string): any => fallback ?? 7.5 }
console.log(new Box().get(), new Box().get("f"))
type One = (a: number) => number
const one: One = a => a + 0.5
console.log(one(1))

// GENERATED: parse run Box getCookie
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = PropGet v0 key="split"
// CHECK-NEXT: v4 = String string="; "
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="split" calleeName="header.split"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = IteratorOpen v6
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v7
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v2
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = PropGet v12 key="indexOf"
// CHECK-NEXT: v14 = String string="="
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="indexOf" calleeName="pair.indexOf"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = PropGet v12 key="slice"
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = Call v17, v12, v18, v16 calleeKey="slice" calleeName="pair.slice"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = PropGet v12 key="slice"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Add v16, v22
// CHECK-NEXT: v24 = Call v21, v12, v23 calleeKey="slice" calleeName="pair.slice"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: ElemSet v2, v20, v25
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v7:
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Double number=1.5
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="f"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v4 = String string="s"
// CHECK-NEXT: v5 = Call v0, -, v4 calleeName="f"
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_14]]}
// CHECK-NEXT: v7 = NewArray v3, v6 contents=boolean|number
// CHECK-NEXT: v8 = PropGet v7 key="join"
// CHECK-NEXT: v9 = Call v8, v7 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_16]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_16]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_17]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getCookie"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="parse"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v8 = ElemGet v4, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
