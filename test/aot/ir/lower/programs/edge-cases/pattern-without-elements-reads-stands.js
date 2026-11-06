// RUN: lower
// OPTIONS: builtin-modules

// A pattern without elements opens an iterator, which reads `next`, and closes it, which calls `return`. Each object here is its own iterator, and nothing but its pattern ever asks it for `next`.
const said = [];
const step = () => ({ done: true });

const [] = {
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("declared");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
};

function take(from) {
  const [] = from;
}
take({
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("declared in a function");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
});

[] = {
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("assigned");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
};

(([]) => {})({
  [Symbol.iterator]() {
    return this;
  },
  get next() {
    said.push("a parameter");
    return step;
  },
  return() {
    said.push("closed");
    return {};
  },
});

class Steps {
  [Symbol.iterator]() {
    return this;
  }
  get next() {
    said.push("of a class");
    return step;
  }
  return() {
    said.push("closed");
    return {};
  }
}
const [] = new Steps();

console.log(said.join("\n"));

// GENERATED: take step [Symbol.iterator] Steps
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=0 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: b5() role=IterationCleanup subject=v1:
// CHECK-NEXT: v4 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="step"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|Array<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=[[L_5]] flags=[IsExpected]} results=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
