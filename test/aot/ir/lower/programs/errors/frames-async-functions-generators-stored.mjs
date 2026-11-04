// RUN: lower
// OPTIONS: builtin-modules

// Prints the names in the stack trace of an error that is made inside async functions and generators, before and behind their first await or yield. Some have a name of their own, others take one from a variable, a property, a field or a default.
const show = label =>
  console.log(
    label + ":",
    new Error().stack
      .split("\n")
      .slice(2)
      .map(line => line.trim().replace(/ ?\(.*| ?[^\s]*[\\/].*/, ""))
      .join(" | "),
  );

const arrow = async () => {
  show("an arrow in a variable, at first");
  await 0;
  show("an arrow in a variable");
};
const expression = async function () {
  show("a function expression in a variable, at first");
  await 0;
  show("a function expression in a variable");
};
const named = async function own() {
  show("a named function expression, at first");
  await 0;
  show("a named function expression");
};
async function declared() {
  show("a declaration, at first");
  await 0;
  show("a declaration");
}
const holder = {
  async method() {
    show("a method, at first");
    await 0;
    show("a method");
  },
  property: async () => {
    await 0;
    show("an arrow in a property");
  },
  plainProperty: async function () {
    await 0;
    show("a function expression in a property");
  },
  ["computed" + 1]: async () => {
    await 0;
    show("an arrow under a computed key");
  },
  async ["computed" + 2]() {
    await 0;
    show("a method under a computed key");
  },
  *steps() {
    show("a generator method, at first");
    yield 1;
    show("a generator method");
  },
};
class Holder {
  static async staticMethod() {
    await 0;
    show("a static method");
  }
  field = async () => {
    await 0;
    show("an arrow in a field");
  };
  static staticField = async function () {
    await 0;
    show("a function expression in a static field");
  };
  async #hidden() {
    await 0;
    show("a private method");
  }
  callHidden() {
    return this.#hidden();
  }
}
let assigned;
assigned = async () => {
  await 0;
  show("an arrow that is assigned");
};
const takeDefault = ({ byDefault = async () => (await 0, show("an arrow that is a default")) }) => byDefault;
const outerArrow = async () => {
  await declared();
  show("an arrow that awaited a declaration");
};
async function outerDeclared() {
  await arrow();
  show("a declaration that awaited an arrow");
}
function* declaredSteps() {
  show("a generator declaration, at first");
  yield 1;
  show("a generator declaration");
}
const stepsExpression = function* () {
  show("a generator expression in a variable, at first");
  yield 1;
  show("a generator expression in a variable");
};
const namedSteps = function* ownSteps() {
  yield 1;
  show("a named generator expression");
};
const plainArrow = () => show("an arrow that is not async");
const plainExpression = function () {
  show("a function expression that is not async");
};

await arrow();
await expression();
await named();
await declared();
await holder.method();
await holder.property();
await holder.plainProperty();
await holder.computed1();
await holder.computed2();
await Holder.staticMethod();
await new Holder().field();
await Holder.staticField();
await new Holder().callHidden();
await assigned();
await takeDefault({})();
await outerArrow();
await outerDeclared();
for (const step of holder.steps());
for (const step of declaredSteps());
for (const step of stepsExpression());
for (const step of namedSteps());
plainArrow();
plainExpression();
await (async () => {
  await 0;
  show("an arrow without a name");
})();
console.log(arrow.name, expression.name, holder.property.name, stepsExpression.name, assigned.name);

// GENERATED: Holder callHidden computed2 takeDefault ownSteps
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callHidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_1]]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = Call v4, v1 calleeName="this.#hidden"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|Promise flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed2"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsNamedByComputedKey] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="show"
// CHECK-NEXT: v5 = String string="a method under a computed key"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takeDefault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="byDefault"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="byDefault"
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v8 = NewClosure function=[[f_10]]
// CHECK-NEXT: Jump -> next b8(v8)
// CHECK-NEXT: b7(v9):
// CHECK-NEXT: Jump -> next b8(v9)
// CHECK-NEXT: b8(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownSteps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="show"
// CHECK-NEXT: v10 = String string="a named generator expression"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
