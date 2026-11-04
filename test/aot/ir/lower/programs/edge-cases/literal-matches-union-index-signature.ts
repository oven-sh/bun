// RUN: lower
// OPTIONS: builtin-modules

// A literal fits only the index signature in a union of an index signature and a record.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
type Either = { [key: string]: number } | { n: string; m: number };
function sum(e: Either): string { let s = ""; for (const k of Object.keys(e)) s += k + "=" + (e as { [key: string]: unknown })[k] + ";"; return s }
row("a literal that the index signature takes", () => sum({ n: 1, m: 2 }));

// GENERATED: sum hide
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = IteratorOpen v6
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v8: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = IteratorResume v7
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v14 = String string="="
// CHECK-NEXT: v15 = Add v12, v14
// CHECK-NEXT: v16 = Convert v0 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v17 = ElemGet v16, v12
// CHECK-NEXT: v18 = Add v15, v17
// CHECK-NEXT: v19 = String string=";"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = Add v8, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b1(v22)
// CHECK-NEXT: b5() role=IterationCleanup subject=v7:
// CHECK-NEXT: v23 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="hide"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
