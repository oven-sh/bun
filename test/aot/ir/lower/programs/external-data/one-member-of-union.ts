// RUN: lower
// OPTIONS: builtin-modules

// An object with the same property names and kinds as one member of a union arrives from JSON under another type.
declare const console: { log(...values: unknown[]): void };
type Done = { lines: string[] };
type Verdict =
  | { over: Done; halted?: string; text?: string; extra?: readonly string[]; goes?: undefined; cut?: true }
  | { over?: undefined; goes: { text: string; title: string | undefined; extra?: readonly string[] }; cut?: true };
type Run = { blocked?: string; cut?: true };
const goes = (text: string, title: string | undefined, extra?: readonly string[]): Verdict => ({ goes: { text, title, ...(extra !== undefined && extra.length > 0 && { extra }) } });
const never = (): Done => ({ lines: ["never"] });
const settled = (run: Run | undefined, text: string, title: string | undefined, extra?: readonly string[]): Verdict => !run ? { over: never() } : run.blocked ? { over: { lines: [run.blocked] }, halted: run.blocked } : { ...goes(text, title, extra), cut: run.cut };
function read(verdict: Verdict): string { if (verdict.over !== undefined) return "over " + verdict.over.lines.join() + " " + verdict.halted; const text = verdict.goes.text; return text + " " + verdict.goes.title + " " + (verdict.goes.extra ?? []).length + " " + verdict.cut; }
async function chain(run: Run | undefined, text: string): Promise<Verdict> { const verdict = settled(run, text, "title", ["x", "y"]); return verdict; }
async function use(run: Run | undefined, text: string): Promise<string> { let verdict: Verdict; if (text.length > 5) verdict = { goes: { text, title: undefined } }; else verdict = await chain(run, text); return read(verdict); }
const all = async () => console.log(await use({}, "e"), "|", await use({ cut: true }, "f"), "|", await use(undefined, "g"), "|", await use({ blocked: "b" }, "h"), "|", await use({}, "longer text"));
// v4: a record with the same names and kinds comes from JSON under another type.
type Alike = { over?: undefined; goes: { text: string; title: string | undefined }; cut?: true }; const alike = JSON.parse(`{"goes":{"text":"p","title":"q"}}`) as Alike; console.log(alike.goes.text); await all();

// GENERATED: chain goes all
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull]}, {type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|[[L_3]]|[[L_4]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_1]], v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="settled"
// CHECK-NEXT: v5 = String string="title"
// CHECK-NEXT: v6 = Data data=[[d_6]]
// CHECK-NEXT: v7 = Call v4, -, v1, v2, v5, v6 calleeName="settled"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]]|[[L_4]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object site=[[w_8]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="goes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_10]] flags=[OmitsNull]}, {type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull]}] results=[{type=undefined|null|[[L_3]]|[[L_4]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: v5 = NewObject -, v3, v4 layout=[[L_14]] fields=[1, 2]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = PropGet v9 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Greater v11, v12
// CHECK-NEXT: Branch v13 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v14 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull]}
// CHECK-NEXT: PropDefine v6, v14 key="extra"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v16 = Convert v6 declared={type=undefined|null|[[L_14]]|[[L_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = NewObject -, v16 layout=[[L_4]] fields=[1]
// CHECK-NEXT: v18 = FinishObject v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_3]]|[[L_4]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v6 = Data data=[[d_19]]
// CHECK-NEXT: v7 = String string="e"
// CHECK-NEXT: v8 = Call v5, -, v6, v7 calleeName="use"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = Await v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = String string="|"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v14 = Data data=[[d_21]]
// CHECK-NEXT: v15 = String string="f"
// CHECK-NEXT: v16 = Call v13, -, v14, v15 calleeName="use"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = Await v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v20 = String string="|"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = String string="g"
// CHECK-NEXT: v24 = Call v21, -, v22, v23 calleeName="use"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = Await v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v28 = String string="|"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v30 = Data data=[[d_24]]
// CHECK-NEXT: v31 = String string="h"
// CHECK-NEXT: v32 = Call v29, -, v30, v31 calleeName="use"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = Await v33
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v36 = String string="|"
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v38 = Data data=[[d_26]]
// CHECK-NEXT: v39 = String string="longer text"
// CHECK-NEXT: v40 = Call v37, -, v38, v39 calleeName="use"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v42 = Await v41
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v44 = Call v4, v2, v11, v12, v19, v20, v27, v28, v35, v36, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
