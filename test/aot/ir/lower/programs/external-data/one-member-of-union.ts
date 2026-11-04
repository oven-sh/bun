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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|[[L_2]]|[[L_3]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol|bigint|[[L_1]], v2: undefined|null|string):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="settled"
// CHECK-NEXT: v5 = String string="title"
// CHECK-NEXT: v6 = Data data=[[d_5]]
// CHECK-NEXT: v7 = Call v4, -, v1, v2, v5, v6 calleeName="settled"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]]|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="goes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull]}, {type=undefined|null|Array<undefined|null|string> flags=[OmitsNull]}] results=[{type=undefined|null|[[L_2]]|[[L_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: v5 = NewObject -, v3, v4 layout=[[L_6]] fields=[1, 2]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b1(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NarrowByTest v2, v8
// CHECK-NEXT: v10 = PropGet v9 key="length"
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Greater v10, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull]}
// CHECK-NEXT: PropDefine v6, v13 key="extra"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Convert v6 declared={type=undefined|null|[[L_6]]|[[L_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = NewObject -, v15 layout=[[L_2]] fields=[1]
// CHECK-NEXT: v17 = FinishObject v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_2]]|[[L_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v6 = Data data=[[d_9]]
// CHECK-NEXT: v7 = String string="e"
// CHECK-NEXT: v8 = Call v5, -, v6, v7 calleeName="use"
// CHECK-NEXT: v9 = Await v8
// CHECK-NEXT: v10 = String string="|"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v12 = Data data=[[d_10]]
// CHECK-NEXT: v13 = String string="f"
// CHECK-NEXT: v14 = Call v11, -, v12, v13 calleeName="use"
// CHECK-NEXT: v15 = Await v14
// CHECK-NEXT: v16 = String string="|"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = String string="g"
// CHECK-NEXT: v20 = Call v17, -, v18, v19 calleeName="use"
// CHECK-NEXT: v21 = Await v20
// CHECK-NEXT: v22 = String string="|"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v24 = Data data=[[d_11]]
// CHECK-NEXT: v25 = String string="h"
// CHECK-NEXT: v26 = Call v23, -, v24, v25 calleeName="use"
// CHECK-NEXT: v27 = Await v26
// CHECK-NEXT: v28 = String string="|"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v30 = Data data=[[d_12]]
// CHECK-NEXT: v31 = String string="longer text"
// CHECK-NEXT: v32 = Call v29, -, v30, v31 calleeName="use"
// CHECK-NEXT: v33 = Await v32
// CHECK-NEXT: v34 = Call v4, v2, v9, v10, v15, v16, v21, v22, v27, v28, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
