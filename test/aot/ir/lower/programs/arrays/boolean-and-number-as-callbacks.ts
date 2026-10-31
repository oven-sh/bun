// RUN: lower
// OPTIONS: builtin-modules

// `list.filter(Boolean)` and `list.map(Number)`: the engine's own Boolean and Number are not called once an element: the loop asks and converts in place. Whatever cannot be done in place (an object that converts itself, a symbol, a list that is no plain array, a function of the program that has the name) goes the way it always went. Held to plain Bun.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string {
    if (Array.isArray(value)) {
        let text = "";
        for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "hole");
        return value.constructor.name + "[" + text + "]";
    }
    if (Object.is(value, -0)) return "-0";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "bigint") return value + "n";
    if (typeof value === "symbol" || typeof value === "function") return typeof value;
    if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
    return String(value);
}
function tell(name: string, make: () => unknown): void {
    let text: string;
    try { text = show(make()); } catch (e) { text = "threw " + (e as Error).constructor.name + ": " + (e as Error).message; }
    console.log(name + ": " + text);
}
class Rows<T> extends Array<T> {}
const one = 1;
const rope = "1" + one + "2" + one;
const everything: unknown[] = [0, -0, NaN, 1, -1, 0.5, "", "a", " ", "0", null, undefined, false, true, {}, [], 0n, 1n, Symbol("s"), () => 0];

tell("everything", () => everything.filter(Boolean));
tell("strings or nothing", () => (["a", null, "", "b", undefined] as (string | null | undefined)[]).filter(Boolean));
tell("integers", () => [0, 1, 2, 0, 3].filter(Boolean));
tell("fractions", () => [0.5, 0, -0, 1.5, 0].filter(Boolean));
tell("objects", () => [{ a: 1 }, null, { b: 2 }].filter(Boolean));
tell("none", () => ([] as unknown[]).filter(Boolean));
tell("all false", () => [0, "", null].filter(Boolean));
tell("a hole", () => [1, , 2, , 0].filter(Boolean));
tell("a hole among fractions", () => [1.5, , 0, 2.5].filter(Boolean));
tell("with this", () => [0, 1].filter(Boolean, { any: 1 }));
tell("an heir", () => Rows.from([0, 1, "", "x"]).filter(Boolean));
tell("frozen", () => Object.freeze([0, 1, "", "x"]).filter(Boolean));
tell("like an array", () => Array.prototype.filter.call({ length: 3, 0: 0, 1: "x", 2: null }, Boolean));
tell("sparse", () => { const list: unknown[] = [1]; list[5000] = 2; list[9000] = 0; return list.filter(Boolean); });
tell("many", () => { const list: number[] = []; for (let i = 0; i < 3000; i++) list.push(i % 3); return list.filter(Boolean).length; });
tell("a function of the program that has the name", () => { const Boolean = (x: unknown) => x === 0; return [0, 1, 0].filter(Boolean); });
tell("kept in a variable", () => { const keep = Boolean; return [0, 1, ""].filter(keep); });
tell("the result is another list", () => { const list = [1, 2]; return list.filter(Boolean) !== list; });

tell("numerals", () => ["1", "2.5", "-3", "1e3", "0x10", "0b11", "  7  ", "", " ", "abc", "Infinity", "-Infinity", "-0", "+4", "1_000", "٣"].map(Number));
tell("a rope", () => [rope, rope + rope].map(Number));
tell("numbers", () => [1, 2.5, -0, NaN].map(Number));
tell("integers to numbers", () => [1, 2, 3].map(Number));
tell("fractions to numbers", () => [1.5, 2.5].map(Number));
tell("strings and numbers", () => (["1", 2, "3.5"] as unknown[]).map(Number));
tell("nothing, true and false", () => ([null, undefined, true, false] as unknown[]).map(Number));
tell("strings, then nothing", () => (["1", "2", null, "4"] as unknown[]).map(Number));
tell("big integers", () => ([1n, "2", 2n ** 70n] as unknown[]).map(Number));
tell("a symbol", () => (["1", Symbol("s")] as unknown[]).map(Number));
tell("objects that convert themselves", () => (["1", { valueOf: () => 7 }, [8], new Date(9), {}] as unknown[]).map(Number));
tell("an object that changes the list", () => { const list: unknown[] = ["1", null, "3", "4"]; list[1] = { valueOf() { list[2] = "30"; list.length = 3; return 2; } }; return list.map(Number); });
tell("no strings", () => ([] as string[]).map(Number));
tell("a hole among strings", () => ["1", , "3"].map(Number));
tell("a hole among fractions, to numbers", () => [1.5, , 3.5].map(Number));
tell("an heir of strings", () => Rows.from(["1", "2"]).map(Number));
tell("split", () => "3,1,2".split(",").map(Number));
tell("like an array of strings", () => Array.prototype.map.call({ length: 2, 0: "5", 1: "6" }, Number));
tell("many strings", () => { const list: string[] = []; for (let i = 0; i < 3000; i++) list.push(String(i)); const made = list.map(Number); return made.length + " " + made[2999]; });
tell("a function of the program named Number", () => { const Number = (x: unknown) => "n" + x; return ["1"].map(Number); });
tell("Number kept in a variable", () => { const convert = Number; return ["1", "x"].map(convert); });

// GENERATED: tell Rows Boolean valueOf
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = Call v1 calleeName="make"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = PropGet v10 key="constructor"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|function site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = PropGet v12 key="name"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Add v9, v14
// CHECK-NEXT: v16 = String string=": "
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = PropGet v10 key="message"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = Add v17, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v21)
// CHECK-NEXT: b6(v22: undefined|null|string):
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = String string=": "
// CHECK-NEXT: v29 = Add v0, v28
// CHECK-NEXT: v30 = Add v29, v22
// CHECK-NEXT: v31 = Call v27, v25, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Rows"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Boolean"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|Array site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=number site=[[w_15]]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = String string="30"
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_17]]}
// CHECK-NEXT: PropSet v0, v5 key="length"
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
