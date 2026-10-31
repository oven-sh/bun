// RUN: lower
// OPTIONS: builtin-modules

// A generic overload over an implementation that is typed with `unknown`. The record type is invariant in its type parameter: the parameter
// stands in a parameter of a function-typed property. So the record that the implementation makes is neither a subtype nor a supertype of
// the record type that the call expects, and it cannot become that type in place: its method reads `this`.
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name; } console.log(label + " ==> " + r); };

interface Counter<T> { value: T; readonly set: (next: T) => void }
function counter<T>(value: T): Counter<T>;
function counter(value: unknown): Counter<unknown> { return { value, set(next) { this.value = next; } }; }
const writtenCounter: Counter<number> = { value: 1, set: next => {} };
say("a primitive parameter, and no other use of the type", () => { const count = counter(0); count.set(41); return count.value + 1 + writtenCounter.value; });

interface Store<T> { value: T; readonly set: (next: T) => void }
function store<T>(value: T): Store<T>;
function store(value: unknown): Store<unknown> { return { value, set(next) { this.value = next; } }; }
const written: Store<number> = { value: 1, set: next => {} };
const writtenText: Store<string> = { value: "w", set: next => {} };
const read = (from: Store<number>) => from.value + 1;
class Holder { held: Store<number> = written; }

say("a primitive parameter", () => { const count = store(0); count.set(41); return count.value + 1 + written.value; });
say("type arguments are written", () => { const count = store<number>(0); count.set(41); return count.value + 1; });
say("two instantiations", () => { const count = store(1); const text = store("a"); text.set("b"); return count.value + 1 + text.value + writtenText.value; });
say("it stays one object", () => { const count = store(0); const same: Store<number> = count; same.set(5); return (count === same) + " " + count.value; });
say("passed to a function", () => read(store(1)) + read(written));
say("each store keeps its own method", () => { const all: Store<number>[] = [store(1), written, store(2)]; for (const each of all) each.set(9); return all.map(each => each.value).join(); });
say("in an array", () => { const all: Store<number>[] = [store(1), written, store(2)]; let sum = 0; for (const each of all) sum += each.value; return sum; });
say("in a field", () => { const holder = new Holder(); holder.held = store(6); holder.held.set(7); return holder.held.value + 1; });
say("its keys", () => Object.keys(store(0)).join());

interface Fold<Out> { readonly run: (box: { value: Out }) => boolean; readonly initial: Out }
function fold<Out>(initial: Out): Fold<Out>;
function fold(initial: unknown): Fold<unknown> { return { initial, run(box) { return box.value === this.initial; } }; }
const other = { initial: 0, run: box => box.value === 100 } satisfies Fold<number>;

say("a record parameter", () => { const step = fold<number>(0); return step.initial + 1 + " " + other.run({ value: 1 }); });
say("the method is called with a record", () => { const step = fold<number>(0); return step.run({ value: 0 }) + " " + step.run({ value: 1 }); });
say("each record keeps its own method", () => { const both: Fold<number>[] = [fold<number>(0), other, fold<number>(100)]; return both.map(each => each.run({ value: 0 }) + "" + each.run({ value: 100 })).join(); });

interface Cell<T> { value: T; readonly set: (next: T) => void }
function cell<T>(value: T): Cell<T> { return { value, set(next) { this.value = next; } }; }
const writtenCell: Cell<number> = { value: 1, set: next => {} };
say("one signature, nothing unverified", () => { const count = cell(0); count.set(41); return count.value + 1 + writtenCell.value; });

interface Rule<T, M extends string | undefined> { value: T; readonly message: M; readonly set: (next: T) => void }
function rule<T>(value: T): Rule<T, undefined>;
function rule<T, const M extends string | undefined>(value: T, message: M): Rule<T, M>;
function rule(value: unknown, message?: string): Rule<unknown, string | undefined> { return { value, message, set(next) { this.value = next; } }; }
const writtenRule: Rule<number, undefined> = { value: 1, message: undefined, set: next => {} };
say("the overload promises undefined where the implementation says string or undefined", () => { const count = rule(0); count.set(41); return count.value + 1 + " " + count.message + " " + writtenRule.value; });
say("the overload promises a literal where the implementation says string or undefined", () => { const count = rule(0, "m"); count.set(41); return count.value + 1 + count.message; });

// GENERATED: counter Holder say read run
// CHECK-LABEL: function {{*}}name="counter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_4]]|[[f_5]]|[[f_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = NewObject -, v0, v2 layout=[[L_1]] fields=[1, 0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Call v1 calleeName="f"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="throws "
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b6(v15: undefined|null|string):
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" ==> "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Add v22, v15
// CHECK-NEXT: v24 = Call v20, v18, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_19]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_20]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_22]]}] functionTypes={{*}}[[f_23]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_24]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=100
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_22]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_20]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_26]]}] functionTypes={{*}}[[f_27]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_20]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="value"
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|[[L_28]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = PropGet v3 key="initial"
// CHECK-NEXT: v5 = StrictEq v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean site=[[w_26]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
