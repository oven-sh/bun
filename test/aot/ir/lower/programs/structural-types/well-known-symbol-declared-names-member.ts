// RUN: lower
// OPTIONS: builtin-modules

// A well known symbol that is only declared names a member.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface SymbolConstructor {
    readonly special: unique symbol;
    readonly other: unique symbol;
  }
}

class Marked {
  [Symbol.special]: number = 1;
  plain: number = 2;
  [Symbol.other](): string {
    return "the method ran";
  }
  read(): number {
    return this[Symbol.special];
  }
}

interface HasSpecial {
  [Symbol.special]: number;
}

function specialOf(value: HasSpecial): number {
  return value[Symbol.special];
}

show("the symbol", () => [Symbol.special, typeof Symbol.special]);
show("are the two the same", () => Object.is(Symbol.special, Symbol.other));
show("its description", () => Symbol.special.description);

const marked = new Marked();
show("read", () => [marked[Symbol.special], marked.read(), specialOf(marked)]);
show("keys", () => Object.keys(marked));
show("own symbols", () => Object.getOwnPropertySymbols(marked).length);
show("JSON", () => JSON.stringify(marked));
show("names of the prototype", () => Object.getOwnPropertyNames(Marked.prototype));
show("the method has the same name, and the field hides it", () => typeof marked[Symbol.other]);
show("the method called", () => marked[Symbol.other]());
show("the method on the prototype", () => Marked.prototype[Symbol.other]());

const literal = { [Symbol.special]: 5, plain: 6 };
show("a literal", () => [specialOf(literal), Object.keys(literal), JSON.stringify(literal)]);
show("both through one function", () => [specialOf(marked), specialOf(literal)]);

marked[Symbol.special] = 9;
show("after a store", () => [marked.read(), Object.keys(marked), JSON.stringify(marked)]);
show("by the word", () => {
  const byName: Record<string, unknown> = { ...marked };
  return byName["undefined"];
});
show("a real symbol beside it", () => {
  const both = { [Symbol.iterator]: 1, [Symbol.special]: 2 };
  return [Object.keys(both), Object.getOwnPropertySymbols(both).length];
});

export {};

// GENERATED: specialOf show Marked read
// CHECK-LABEL: function {{*}}name="specialOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Symbol
// CHECK-NEXT: v2 = PropGet v1 key="special"
// CHECK-NEXT: v3 = ElemGet v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Marked"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_10]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_11]]} results=[{type=number site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Symbol
// CHECK-NEXT: v2 = PropGet v1 key="special"
// CHECK-NEXT: v3 = ElemGet v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
