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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_3]] site=[[w_4]]}] results=[{type=undefined|null|[[L_5]] site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="last"
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_7]]
// CHECK-NEXT: v5 = Call v0, -, v1 calleeName="engine"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|[[L_5]] site=[[w_8]]}}, {declared={type=undefined|null|[[L_5]] site=[[w_6]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|[[L_13]] site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]], v1: undefined|null|[[f_11]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v4 = CopyObject v2
// CHECK-NEXT: PropDefine v4, v0 key="context"
// CHECK-NEXT: v6 = NewClosure function=[[f_16]]
// CHECK-NEXT: PropDefine v4, v6 key="may"
// CHECK-NEXT: v8 = Convert v4 declared={type=undefined|null|[[L_17]] site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Call v3, -, v1, v8 calleeName="inner"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|[[L_5]] site=[[w_19]]}}, {declared={type=undefined|null|[[L_13]] site=[[w_14]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="resume"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_23]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="reply"
// CHECK-NEXT: v2 = String string="!"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v4 key="reply"
// CHECK-NEXT: v6 = PropGet v0 key="agent"
// CHECK-NEXT: v7 = PropGet v0 key="context"
// CHECK-NEXT: v8 = PropGet v7 key="id"
// CHECK-NEXT: v9 = PropGet v0 key="may"
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = String string="no"
// CHECK-NEXT: v15 = Call v13, v0, v14 calleeKey="may" calleeName="args.may"
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean site=[[w_25]]}
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = PropGet v0 key="reply"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="last"
// CHECK-NEXT: v21 = StrictEq v0, v20
// CHECK-NEXT: v22 = NewArray v6, v8, v17, v18, v21 contents=undefined|null|boolean|number|string
// CHECK-NEXT: v23 = PropGet v22 key="join"
// CHECK-NEXT: v24 = String string=" "
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_27]] site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_29]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_27]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="input"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: v6 = PropGet v5 key="input"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v8 = PropGet v5 key="context"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_9]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: v11 = Await v10, v7, v9
// CHECK-NEXT: v12 = Convert v11 declared={type=null site=[[w_30]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = PropGet v9 key="id"
// CHECK-NEXT: v14 = Add v7, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string|object site=[[w_31]]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="may"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_32]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_33]]}] functionTypes={{*}}[[f_34]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="no"
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_33]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
