// RUN: lower
// OPTIONS: builtin-modules

// A generic forwarder builds `{ ...opts, context, may } as P` (P extends Base) and passes it to a function it received as an
// argument. The function's parameter is a wider record type, named or written in place and destructured.
type Ctx = { id: number; round?: number };
type Base = { context: Ctx; may?: (name: string) => boolean };
type ResumeArgs = { context: Ctx; may?: (name: string) => boolean; agent: string; reply: string };
let last: unknown = null;
function inner<P extends Base, R>(engine: (opts: P) => R, all: P): R {
  last = all;
  return engine(all);
}
function run<P extends Base, R>(context: Ctx, engine: (opts: P) => R, opts: Omit<P, keyof Base>): R {
  return inner(engine, { ...opts, context, may: (n: string) => n !== "no" } as P);
}
function launch({ input, context, may, message, timing, parent, depth }: { context: Ctx; may?: (name: string) => boolean; input: string; message: string; timing?: number; parent?: string; depth: number }): string {
  return [input, context.id, may?.("x"), message, timing ?? "-", parent ?? "-", depth].join(" ");
}
function resume(args: ResumeArgs): string {
  args.reply += "!";
  return [args.agent, args.context.id, args.may?.("no"), args.reply, (args as unknown) === last].join(" ");
}
async function later({ input, context }: { context: Ctx; may?: (name: string) => boolean; input: string }): Promise<string> {
  await null;
  return input + context.id;
}
console.log(run({ id: 1 }, launch, { input: "i", message: "m", timing: 3, depth: 1 }));
console.log(run({ id: 2, round: 4 }, launch, { input: "j", message: "n", depth: 2 }));
console.log(run({ id: 3 }, resume, { agent: "a", reply: "r" }), (last as ResumeArgs).reply);
console.log(await run({ id: 4 }, later, { input: "k" }));

// GENERATED: inner run resume later may
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|[[L_2]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="last"
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v5 = Call v0, -, v1 calleeName="engine"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: undefined|null|[[f_5]], v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = CopyObject v2
// CHECK-NEXT: PropDefine v4, v0 key="context"
// CHECK-NEXT: v6 = NewClosure function=[[f_7]]
// CHECK-NEXT: PropDefine v4, v6 key="may"
// CHECK-NEXT: v8 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Call v3, -, v1, v8 calleeName="inner"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resume"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: v1 = PropGet v0 key="reply"
// CHECK-NEXT: v2 = String string="!"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: PropSet v0, v3 key="reply"
// CHECK-NEXT: v5 = PropGet v0 key="agent"
// CHECK-NEXT: v6 = PropGet v0 key="context"
// CHECK-NEXT: v7 = PropGet v6 key="id"
// CHECK-NEXT: v8 = PropGet v0 key="may"
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = String string="no"
// CHECK-NEXT: v14 = Call v12, v0, v13 calleeKey="may" calleeName="args.may"
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = PropGet v0 key="reply"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="last"
// CHECK-NEXT: v19 = StrictEq v0, v18
// CHECK-NEXT: v20 = NewArray v5, v7, v15, v16, v19 contents=anything
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = String string=" "
// CHECK-NEXT: v23 = Call v21, v20, v22 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v23 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_9]]):
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="input"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v5 key="input"
// CHECK-NEXT: v7 = PropGet v5 key="context"
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: v9 = Await v8, v6, v7
// CHECK-NEXT: v10 = PropGet v7 key="id"
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string|object}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="may"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = String string="no"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
