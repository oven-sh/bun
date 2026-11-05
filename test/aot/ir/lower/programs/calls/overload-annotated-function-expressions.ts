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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = PropGet v0 key="split"
// CHECK-NEXT: v4 = String string="; "
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="split" calleeName="header.split"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = IteratorOpen v6
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v7
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="indexOf"
// CHECK-NEXT: v14 = String string="="
// CHECK-NEXT: v15 = Call v13, v12, v14 calleeKey="indexOf" calleeName="pair.indexOf"
// CHECK-NEXT: v16 = Convert v15 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = PropGet v12 key="slice"
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = Call v17, v12, v18, v16 calleeKey="slice" calleeName="pair.slice"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v21 = PropGet v12 key="slice"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Add v16, v22
// CHECK-NEXT: v24 = Call v21, v12, v23 calleeKey="slice" calleeName="pair.slice"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: ElemSet v2, v20, v25
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v7:
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: v1 = Double number=1.5
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="f"
// CHECK-NEXT: v3 = String string="s"
// CHECK-NEXT: v4 = Call v0, -, v3 calleeName="f"
// CHECK-NEXT: v5 = NewArray v2, v4 contents=anything
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getCookie"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="parse"
// CHECK-NEXT: v4 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = NarrowByTest v1, v5
// CHECK-NEXT: v7 = ElemGet v3, v6
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
