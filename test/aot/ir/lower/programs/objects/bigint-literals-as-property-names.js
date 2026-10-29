// RUN: lower
// OPTIONS: builtin-modules

// BigInt literals as property names in object literals: decimal, hexadecimal, octal and binary.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const show = (o) => JSON.stringify(o) + " " + Object.keys(o).join();
row("row 74", () => { let n = 0; return [{ 1n: ++n }[1], n].join(" "); });
row("row 76", () => { let n = 0; return [{ 5n: ++n }[5], n].join(" "); });
row("the order of the values", () => { let n = 0; const f = () => ++n; return n + " " + show({ a: f(), 5n: f(), b: f() }); });
row("hexadecimal", () => show({ 0x1fn: 1 }));
row("hexadecimal, capitals", () => show({ 0X1Fn: 1 }));
row("octal", () => show({ 0o17n: 1 }));
row("binary", () => show({ 0b101n: 1 }));
row("separators", () => show({ 1_000n: 1 }));
row("zero", () => show({ 0n: 1 }));
row("too large for an index", () => show({ 12345678901234567890n: 1, a: 2, 3n: 3 }));
row("beyond 2 ** 64", () => show({ 0xffffffffffffffffffn: 1 }));
row("a number of the name ahead", () => show({ 1: "number", 1n: "bigint" }));
row("a number of the name behind", () => show({ 1n: "bigint", 1: "number" }));
row("a string of the name", () => show({ "1": "string", 1n: "bigint" }));
row("the string with the n is another", () => show({ "1n": "string", 1n: "bigint" }));
row("read by a string", () => ({ 7n: "v" })["7"]);
row("read by a bigint", () => ({ 7n: "v" })[7n]);
row("in", () => [1 in { 1n: 0 }, "1" in { 1n: 0 }, "1n" in { 1n: 0 }].join());
row("a method", () => ({ 1n() { return "m"; } })[1]());
row("a method's name", () => ({ 1n() {} })[1].name);
row("a generator method", () => [...{ *1n() { yield "y"; } }[1]()].join());
row("the name of a function value", () => ({ 1n: function () {} })[1].name);
row("the name of an arrow value", () => ({ 0x10n: () => {} })[16].name);
row("the name of a class value", () => ({ 1n: class {} })[1].name);
row("a binding pattern", () => { const { 1n: x } = { 1: "one", "1n": "as written" }; return x; });
row("a binding pattern, a default", () => { const { 1n: x = "default" } = { "1n": "as written" }; return x; });
row("a binding pattern, hexadecimal", () => { const { 0x10n: x } = { 16: "sixteen" }; return x; });
row("a binding pattern, nested", () => { const { 1n: { 2n: x } } = { 1: { 2: "deep" } }; return x; });
row("a parameter's pattern", () => (({ 1n: x }) => x)({ 1: "one" }));
row("an assignment pattern", () => { let x; ({ 1n: x } = { 1: "one", "1n": "as written" }); return x; });
row("rest leaves it out", () => { const { 1n: x, ...rest } = { 1: "one", 2: "two", "1n": "as written" }; return x + " " + show(rest); });
row("over an array", () => { const { 1n: x } = ["zero", "one"]; return x; });
row("a field", () => { class C { 1n = "field"; } return show(new C()); });
row("a method of a class", () => { class C { 3n() { return "method"; } } return new C()[3]() + " " + new C()[3].name; });
row("a field's value is evaluated", () => { let n = 0; class C { 1n = ++n; } new C(); new C(); return n; });
row("a field, the name of its function", () => { class C { 1n = () => {}; } return new C()[1].name; });
row("the names of the prototype", () => { class C { 3n() {} 1n() {} a() {} } return Object.getOwnPropertyNames(C.prototype).join(); });
row("control: a computed bigint", () => show({ [5n]: 2 }));
row("control: a number", () => show({ 5: 2 }));
row("control: a hexadecimal number", () => show({ 0x5: 2 }));
row("control: the string with the n", () => show({ "5n": 2 }));

// GENERATED: f 1 a
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="n"
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_1]]
// CHECK-NEXT: v8 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="m"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = String string="y"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
