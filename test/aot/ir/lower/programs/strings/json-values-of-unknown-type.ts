// RUN: lower
// OPTIONS: builtin-modules

// `JSON.stringify` of typed objects whose `unknown` fields hold every kind of value, and the generic answer where the writer declines.
const print = (s: string) => console.log(s);
interface Box { before: number; value: unknown; after: string }
interface Point { x: number; y: number }
class L extends Array<number> { }
class Mixed extends Array<unknown> { }
class Labeled extends Array<number> {
    toJSON(): string {
        return "from subclass";
    }
}
class LaterDate extends Date { }

function box(value: unknown): Box {
    return { before: 1, value, after: "end" };
}
function attempt(f: () => unknown): string {
    try {
        return String(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function show(label: string, value: unknown): void {
    print(label);
    print("  property " + attempt(() => JSON.stringify(box(value))));
    print("  element  " + attempt(() => JSON.stringify([value, 2])));
    print("  nested   " + attempt(() => JSON.stringify(box(box(value)))));
    print("  root     " + attempt(() => JSON.stringify(value)));
}
function cat(a: string, b: string): string {
    return a + b;
}
function nestedArrays(depth: number): unknown {
    let value: unknown = [];
    for (let i = 0; i < depth; i++)
        value = [value];
    return value;
}
function pointWithExtraProperties(): Point {
    const point: Point = { x: 1, y: 2 };
    (point as any).z = "extra";
    (point as any)["with space"] = [3];
    return point;
}
function subclassInstance(): L {
    const list = new L();
    list.push(1, 2, 3);
    return list;
}
function mixedSubclassInstance(): Mixed {
    const list = new Mixed();
    list.push(1, "two", "日", { three: 3 }, [4]);
    return list;
}
function labeledSubclassInstance(): Labeled {
    const list = new Labeled();
    list.push(1, 2);
    return list;
}
function sparseSubclassInstance(): L {
    const list = new L(3);
    list[0] = 1;
    return list;
}

const point: Point = { x: 1, y: 2.5 };
show("typed object", point);
show("extra properties", pointWithExtraProperties());
show("ints", [1, 2, 3]);
show("doubles", [1.5, -0, 1e21, 2.5]);
show("strings", ["a", "b\"c", "日本"]);
show("typed objects", [point, { x: 3, y: 4 } as Point, point]);
show("nested arrays", nestedArrays(50));
show("shallow nested arrays", nestedArrays(5));
show("subclass", subclassInstance());
show("subclass with plain object", mixedSubclassInstance());
show("empty subclass", new L());
show("null prototype array", Object.setPrototypeOf([1, 2], null));
show("date", new Date(0));
show("invalid date", new Date(NaN));
show("wide string", "日本語");
show("wide string to escape", "日\"\n\ud800");
show("escapes", "quote \" backslash \\ newline \n tab \t control \u0001 end");
show("rope", cat("left side of the rope ".repeat(3), "right side of the rope ".repeat(3)));
show("wide rope", cat("left ".repeat(8), "日本".repeat(8)));
show("primitives", [null, true, false, 0, NaN, Infinity]);

show("function", () => 1);
show("symbol", Symbol("s"));
show("undefined", undefined);
show("function with toJSON", Object.assign(() => 1, { toJSON() { return "from function"; } }));
show("object with toJSON", { a: 1, toJSON() { return "from object"; } });
show("array with toJSON", Object.assign([1, 2], { toJSON() { return "from array"; } }));
show("subclass with toJSON", labeledSubclassInstance());
show("subclass instance with own toJSON", Object.assign(subclassInstance(), { toJSON() { return "from instance"; } }));
show("subclass with hole", sparseSubclassInstance());
show("array with toJSON on new prototype", Object.setPrototypeOf([1, 2], { toJSON() { return "from prototype"; } }));
const withGetter = pointWithExtraProperties();
Object.defineProperty(withGetter, "computed", { get() { return 7; }, enumerable: true });
show("getter among extra properties", withGetter);
show("hole", [1, , 3]);
show("wide string before hole", ["日", , 1]);
show("undefined and symbol elements", [undefined, Symbol("s"), () => 1]);
show("bigint", BigInt(10));
show("bigint element", [1, BigInt(10)]);
show("date subclass", new LaterDate(0));
print(attempt(() => JSON.stringify(undefined)));
print(attempt(() => JSON.stringify(() => 1)));
(L.prototype as any).toJSON = function () { return "added later"; };
show("subclass after toJSON is added", subclassInstance());

// GENERATED: attempt nestedArrays mixedSubclassInstance print L get
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="throws "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nestedArrays"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_6]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_7]]
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b2(v1, v3)
// CHECK-NEXT: b2(v4, v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Less v5, v0
// CHECK-NEXT: Branch v7 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v8, v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = NewArray v4 contents=anything
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = Increment v8
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b2(v10, v12)
// CHECK-NEXT: b6(v13, v14):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mixedSubclassInstance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Mixed"
// CHECK-NEXT: v2 = Construct v1 calleeName="Mixed"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_9]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = String string="two"
// CHECK-NEXT: v7 = String string="\u{65e5}"
// CHECK-NEXT: v8 = Data data=[[d_13]]
// CHECK-NEXT: v9 = Data data=[[d_14]]
// CHECK-NEXT: v10 = Call v4, v3, v5, v6, v7, v8, v9 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="print"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="L"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_18]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_18]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_19]]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_19]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
