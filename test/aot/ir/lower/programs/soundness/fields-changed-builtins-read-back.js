// RUN: lower
// OPTIONS: builtin-modules

// Fields changed through built ins are read back.
function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
const point = { x: 1, y: 2 };
const read = o => o.x + ":" + o.y + ":" + Object.keys(o).join();
attempt("as made", () => read(point));
attempt("assign", () => read(Object.assign(point, { x: "s", z: 3 })));
attempt("defineProperty", () => read(Object.defineProperty(point, "y", { get() { return "got"; }, enumerable: true, configurable: true })));
attempt("defineProperties", () => read(Object.defineProperties(point, { w: { value: 4, enumerable: true }, x: { value: null, writable: true, enumerable: true, configurable: true } })));
attempt("Reflect.set", () => (Reflect.set(point, "x", 5n), read(point)));
attempt("Reflect.defineProperty", () => (Reflect.defineProperty(point, "x", { value: Symbol.iterator.description }), read(point)));
attempt("Reflect.deleteProperty", () => (Reflect.deleteProperty(point, "x"), read(point)));
attempt("setPrototypeOf", () => (Object.setPrototypeOf(point, { x: "inherited" }), read(point)));
attempt("__proto__", () => ((point.__proto__ = { x: "by __proto__" }), read(point)));
attempt("__defineGetter__", () => (point.__defineGetter__("x", () => "old style"), read(point)));
attempt("computed", () => { const key = ["x"].join(""); delete point[key]; point[key] = [1]; return read(point); });
attempt("entries", () => read(Object.fromEntries(Object.entries(point).map(([k, v]) => [k, typeof v]))));
attempt("spread", () => read({ ...point, x: undefined }));
attempt("with a proxy", () => { const p = new Proxy(point, { set(t, k, v) { t[k] = v + "!"; return true; } }); p.x = "through"; return read(point); });
attempt("structuredClone", () => read(structuredClone({ x: new Date(0), y: /r/g })).length);
attempt("JSON", () => read(JSON.parse(JSON.stringify({ x: { toJSON() { return [2]; } }, y: undefined }))));
attempt("array methods", () => { const a = [point]; a.fill({ x: "filled", y: 0 }); return read(a[0]) + read(a.with(0, { x: "with", y: 1 })[0]) + read(a.toSpliced(0, 1, { x: "spliced", y: 2 })[0]) + read(a.copyWithin(0, 0)[0]); });
attempt("sort moves", () => { const a = [{ x: 2, y: "b" }, { x: 1, y: 7 }]; a.sort((p, q) => p.x - q.x); return read(a[0]) + read(a.reverse()[0]) + read(a.toSorted((p, q) => p.x - q.x)[0]); });
attempt("freeze then store", () => { const f = Object.freeze({ x: 1, y: 2 }); f.x = 9; return read(f); });
attempt("class fields redefined", () => { class C { x = 1; y = 2; } const c = new C(); Object.defineProperty(c, "x", { get: () => "getter", enumerable: true }); return read(c); });
attempt("instance gets another prototype", () => { class C { x = 1; get y() { return "from C"; } } class D { get y() { return "from D"; } } const c = new C(); Object.setPrototypeOf(c, D.prototype); return read(c) + (c instanceof C); });
attempt("prototype method replaced", () => { class C { m() { return 1; } } const c = new C(); const before = c.m(); C.prototype.m = () => "replaced"; return before + c.m(); });
attempt("arguments alias", () => (function (a) { "sloppy"; arguments[0] = "aliased"; return typeof a + arguments.length; })(1));

// GENERATED: attempt read set y D
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="throws"
// CHECK-NEXT: v16 = PropGet v9 key="name"
// CHECK-NEXT: v17 = Call v14, v12, v0, v15, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="y"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = Add v7, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|string|symbol, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="!"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: ElemSet v0, v1, v4
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="from C"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="y"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="from D"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
