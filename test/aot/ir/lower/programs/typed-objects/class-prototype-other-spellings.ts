// RUN: lower
// OPTIONS: builtin-modules

// `C.prototype` is declared to be a `C` and is none. However it is spelled and wherever it is kept, a method that is replaced on it is replaced.
const attempt = (label: string, f: () => unknown): void => {
  try {
    console.log(label + ": " + f());
  } catch (e) {
    console.log(label + ": throws " + (e as Error).name);
  }
};
class Dots { m(): string { return "Dots.m"; } }
attempt("dots", () => { const made = new Dots(), was = made.m(); (Dots.prototype as any).m = () => "patched"; return [was, made.m(), new Dots().m()]; });
class Brackets { m(): string { return "Brackets.m"; } }
attempt("prototype in brackets", () => { const made = new Brackets(), was = made.m(); (Brackets["prototype"] as any).m = () => "patched"; return [was, made.m(), new Brackets().m()]; });
class Both { m(): string { return "Both.m"; } }
attempt("both in brackets", () => { const made = new Both(), was = made.m(); (Both["prototype"] as any)["m"] = () => "patched"; return [was, made.m(), new Both().m()]; });
class Typed { m(): string { return "Typed.m"; } }
attempt("in brackets, typed", () => { const made = new Typed(), was = made.m(); Typed["prototype"].m = () => "patched"; return [was, made.m(), new Typed().m()]; });
class Kept { n = 1; m(): string { return "Kept.m" + this.n; } }
attempt("kept in a constant", () => { const made = new Kept(), was = made.m(); const kept = Kept.prototype; kept.m = () => "patched"; return [was, made.m(), new Kept().m(), kept.n, kept instanceof Kept, Object.keys(kept).length]; });
class Annotated { n = 1; m(): string { return "Annotated.m" + this.n; } }
attempt("kept under its declared type", () => { const made = new Annotated(), was = made.m(); const kept: Annotated = Annotated["prototype"]; kept.m = () => "patched"; return [was, made.m(), new Annotated().m(), kept instanceof Annotated]; });
class Handed { n = 2; m(): string { return "Handed.m"; } }
const describe = (object: Handed): string => object.m() + " " + (object instanceof Handed) + " " + Object.keys(object).length;
attempt("handed to a function", () => [describe(new Handed()), describe(Handed.prototype), describe(Handed["prototype"])]);
class Untouched { n = 3; m(): number { return this.n; } }
attempt("a class whose prototype object is only read", () => [typeof Untouched.prototype.m, Untouched["prototype"].m.call(new Untouched()), Object.getOwnPropertyNames(Untouched["prototype"]).join()]);

// GENERATED: Kept attempt describe
// CHECK-LABEL: function {{*}}name="Kept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Call v1 calleeName="f"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v12 = CatchValue
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string=": throws "
// CHECK-NEXT: v19 = Add v0, v18
// CHECK-NEXT: v20 = Convert v12 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = PropGet v20 key="name"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v23 = Add v19, v22
// CHECK-NEXT: v24 = Call v17, v15, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="m"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="m" calleeName="object.m"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = String string=" "
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Handed"
// CHECK-NEXT: v8 = InstanceOf v0, v7 writtenExpression="object instanceof Handed"
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v14 = Call v13, v12, v0 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v15 key="length"
// CHECK-NEXT: v17 = Add v11, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
