// RUN: lower
// OPTIONS: builtin-modules

// A union of four records. Parsed data is held to it in one place; in another a record is made for it by a spread.
// One arm holds an object of a class; the other three hold data alone.
class Reply<T> { constructor(public body: T, public code: number) {} text() { return String(this.code) } }
type W = { w: number }
type Result<T> = { ok: true; data: T; status: number; reply: Reply<T>; mark?: null | string } | { ok: false; reason: "a" } | { ok: false; reason: "b" } | { ok: false; reason: "c"; detail: string }
type Routed<T> = Result<T> & { route: "direct" | "far"; fromFar: boolean; a?: number; b?: W; c?: number; d?: "x" | "y"; e?: number }
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function make<T>(x: T): Result<T> { return typeof x === "boolean" ? { ok: true, data: x, status: 201.5, reply: new Reply(x, 2), mark: "m" } : { ok: true, data: x, status: 200.5, reply: new Reply(x, 1) } }
async function direct<T>(x: T): Promise<Result<T>> { return x === null ? { ok: false, reason: "a" } : x === undefined ? { ok: false, reason: "c", detail: "none" } : make<T>(x) }
function client() {
  return {
    get: async <T,>(x: T): Promise<Routed<T>> => {
      const sendDirect = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "direct", fromFar: true })
      const sendFar = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "far", fromFar: false, a: 1.5, b: { w: 2 }, c: 3.5, d: "x", e: 5.5 })
      return typeof x === "string" ? sendFar() : sendDirect()
    },
  }
}
const api = client()
async function use(x: unknown) {
  let res: Routed<unknown>
  res = await api.get<unknown>(x)
  if (!res.ok) return "not ok " + res.reason
  if (!res.fromFar) return "near " + res.a
  return res.status + " " + res.route + " " + JSON.stringify(res.data) + " " + res.reply.text() + " " + (res.mark ?? "-") + (res.a ?? "-")
}
function replayed(text: string) {
  const boot: Routed<unknown> = travel(JSON.parse(text))
  return boot.ok ? "ok" : boot.reason === "c" ? boot.reason + boot.detail + boot.route : boot.reason + boot.route
}
try { console.log("parsed data: " + replayed('{"ok":false,"reason":"c","detail":"d","route":"far","fromFar":false}')) } catch (e) { console.log("parsed data: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }

// GENERATED: travel client use Reply text sendDirect
// CHECK-LABEL: function {{*}}name="travel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="bag"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="push" calleeName="bag.push"
// CHECK-NEXT: v5 = Convert v4 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="bag"
// CHECK-NEXT: v8 = PropGet v7 key="pop"
// CHECK-NEXT: v9 = Call v8, v7 calleeKey="pop" calleeName="bag.pop"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="client"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_2]]
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="use"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="use"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Reply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=number}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: number):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_5]]
// CHECK-NEXT: PropSet v5, v1 key="body"
// CHECK-NEXT: PropSet v5, v2 key="code"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="code"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sendDirect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] syntax=[HasWrittenAwait] captures=[{type=anything variableName="x"}] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_6]]|[[L_7]]|[[L_8]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="direct"
// CHECK-NEXT: v3 = Await v2
// CHECK-NEXT: v4 = CopyObject v3
// CHECK-NEXT: v5 = String string="direct"
// CHECK-NEXT: PropDefine v4, v5 key="route"
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: PropDefine v4, v7 key="fromFar"
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|object}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
