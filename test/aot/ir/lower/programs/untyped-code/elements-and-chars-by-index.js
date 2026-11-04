// RUN: lower
// OPTIONS: builtin-modules

// value[index] in code without types, where the index is a whole number the compiler can see, a number it cannot, or no number at all, and the value is an array of values, of integers,
// of doubles, with holes, empty, a string of one-byte or two-byte characters, flat, cut out or put together, a typed array of every kind, an arguments object, or nothing that has elements.
const lines = [];
function at(value, index) { return value[index]; }
function atWhole(value, index) { return value[index | 0]; }
function first(value) { return value[0]; }
function third(value) { return value[2]; }
function walk(value) { let out = ""; for (let i = 0; i < value.length; i++) out += show(value[i]) + ","; return out; }
function show(x) { return typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : typeof x === "object" && x ? "{}" : Object.is(x, -0) ? "-0" : String(x); }
function argumentsOf() { return arguments; }
const holes = [1, , "three", , 5];
const grown = []; grown[3] = "late";
const flat = "plain text";
const wide = "中文 and more é";
const narrowInWide = ("中" + "abc").slice(1);
const rope = flat + " " + wide.slice(3);
const longRope = "0123456789".repeat(3) + flat;
const values = [
    ["a", {}, null, undefined, 5], [1, 2, 3], [1.5, 2.5, NaN, -0], holes, grown, [], new Array(4), [[1], [2], [3]],
    flat, wide, narrowInWide, rope, longRope, "", "x", flat.slice(2, 7), new String("boxed"),
    new Int8Array([-1, 2, 3]), new Uint8Array([255, 2, 3]), new Uint8ClampedArray([300, 2, 3]), new Int16Array([-300, 2, 3]), new Uint16Array([65535, 2, 3]),
    new Int32Array([-70000, 2, 3]), new Uint32Array([4294967295, 2, 3]), new Float32Array([1.5, NaN, -0]), new Float64Array([1e300, NaN, -0]), new BigInt64Array([-1n, 2n, 3n]), new BigUint64Array([1n, 2n, 3n]),
    new Uint8Array(0), new Uint8Array(new ArrayBuffer(8), 2, 3),
    argumentsOf("p", "q", "r"), argumentsOf(), { 0: "zero", 1: "one", 2: "two", length: 3 }, { length: 2 }, function (a, b) { }, 5, true, Symbol.iterator, 10n,
];
const indexes = [0, 1, 2, 3, 4, 5, 9, 10, 100, -1, -0, 1.0, 1.5, 2147483647, 2147483648, 4294967295, 4294967296, -2147483648, NaN, Infinity, "0", "1", "01", "-1", "1.0", "length", "", null, undefined, true, {}, [1], Symbol.iterator];
for (let round = 0; round < 3; round++) {
    const rows = values.map(value => indexes.map(index => show(at(value, index))).join(" ") + " | " + indexes.slice(0, 20).map(index => show(atWhole(value, index))).join(" ") + " | " + show(first(value)) + " " + show(third(value)));
    if (round === 2)
        lines.push(...rows);
}
for (const value of values) {
    if (value != null && typeof value.length === "number")
        lines.push(walk(value));
}
for (const nothing of [undefined, null]) {
    for (const index of [0, 1.5, "a"]) {
        try { lines.push(show(at(nothing, index))); } catch (error) { lines.push(error.constructor.name); }
        try { lines.push(show(atWhole(nothing, index))); } catch (error) { lines.push(error.constructor.name); }
    }
}
function escape(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        out += c === "<" ? "&lt;" : c === "&" ? "&amp;" : c === "中" ? "?" : c;
    }
    return out;
}
lines.push(escape("a<b&c"), escape(wide + "<"), escape(rope + "&"), escape(""));
const shrinking = [1, 2, 3, 4];
lines.push(show(third(shrinking)));
shrinking.length = 2;
lines.push(show(third(shrinking)), show(at(shrinking, 1)), show(atWhole(shrinking, 3)));
shrinking.push("x", 1.5);
lines.push(show(third(shrinking)), walk(shrinking));
console.log(lines.join("\n"));

// GENERATED: atWhole show argumentsOf
// CHECK-LABEL: function {{*}}name="atWhole"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array, v1: i32):
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = BitOr v1, v2
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|bigint flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|bigint):
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Builtin builtin=JSON
// CHECK-NEXT: v5 = PropGet v4 key="stringify"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6, v4, v3 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByTest v0, v8
// CHECK-NEXT: v10 = TypeTest v9 testedType=bigint
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = NarrowByTest v0, v11
// CHECK-NEXT: v13 = String string="n"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: Jump -> next b10(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = NarrowByTest v0, v15
// CHECK-NEXT: v17 = TypeTest v16 testedType=function
// CHECK-NEXT: Branch v17 -> taken b8(), notTaken b5(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = TypeTest v18 testedType=null|object
// CHECK-NEXT: Branch v19 -> taken b6(| 0), notTaken b8()
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = ToBoolean v16
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b8()
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = String string="{}"
// CHECK-NEXT: Jump -> next b10(v23)
// CHECK-NEXT: b8():
// CHECK-NEXT: v24 = Builtin builtin=Object
// CHECK-NEXT: v25 = Builtin builtin=ObjectIs
// CHECK-NEXT: v26 = Double number=-0
// CHECK-NEXT: v27 = Call v25, v24, v16, v26 calleeName="Object.is"
// CHECK-NEXT: v28 = ToBoolean v27
// CHECK-NEXT: Branch v28 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: v30 = String string="-0"
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b10(v31):
// CHECK-NEXT: Return v31
// CHECK-NEXT: b11(v32):
// CHECK-NEXT: v33 = Builtin builtin=String
// CHECK-NEXT: v34 = Call v33, -, v16 calleeName="String"
// CHECK-NEXT: ReturnCall v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="argumentsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: Array):
// CHECK-NEXT: v2 = CreateUnmappedArguments v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
