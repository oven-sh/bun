// RUN: lower
// OPTIONS: builtin-modules

// Code that tests the tag of a union can't trust the tag: it is overwritten through `any` and through a base type, deleted, inherited, replaced by a getter, and stored between the read and the comparison.
const enum Kind {
  Circle = 1,
  Square = 2,
  Label = 3,
}

interface Base {
  kind: Kind;
  id: number;
}

interface Circle extends Base {
  kind: Kind.Circle;
  radius: number;
}

interface Square extends Base {
  kind: Kind.Square;
  side: number;
}

interface Label extends Base {
  kind: Kind.Label;
  text: string;
}

type Shape = Circle | Square | Label;

let nextId = 0;

function circle(radius: number): Circle {
  return { kind: Kind.Circle, id: nextId++, radius };
}

function square(side: number): Square {
  return { kind: Kind.Square, id: nextId++, side };
}

function label(text: string): Label {
  return { kind: Kind.Label, id: nextId++, text };
}

function describeByIf(s: Shape): string {
  if (s.kind === Kind.Circle) return "circle " + s.radius;
  if (s.kind === Kind.Square) return "square " + s.side;
  if (s.kind !== Kind.Label) return "no kind";
  return "label " + s.text;
}

function describeBySwitch(s: Shape): string {
  switch (s.kind) {
    case Kind.Circle:
      return "circle " + s.radius;
    case Kind.Square:
      return "square " + s.side;
    case Kind.Label:
      return "label " + s.text;
  }
  return "no kind";
}

function measure(s: Shape): number {
  switch (s.kind) {
    case Kind.Circle:
      return s.radius * 2;
    case Kind.Square:
      return s.side * 4;
    case Kind.Label:
      return s.text.length;
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function show(title: string, s: Shape) {
  const answers = [describeByIf(s), describeBySwitch(s), attempt(() => measure(s)), Object.keys(s).join()];
  console.log(title + ":", answers.join(" | "));
}

function storeTag(o: any, tag: any) {
  o.kind = tag;
}

function storeTagThroughBase(b: Base, kind: Kind) {
  b.kind = kind;
}

function storeBeforeComparison(s: Shape, tag: Kind): string {
  if (s.kind === (storeTag(s, tag), Kind.Circle)) return "was a circle " + s.radius + ", is " + describeBySwitch(s);
  return "was no circle, is " + describeBySwitch(s);
}

function storeBeforeCase(s: Shape, tag: Kind): string {
  switch (s.kind) {
    case (storeTag(s, tag), Kind.Circle):
      return "was a circle " + s.radius + ", is " + describeByIf(s);
    case Kind.Square:
      return "was a square " + s.side + ", is " + describeByIf(s);
  }
  return "was something else, is " + describeByIf(s);
}

const untouched: Shape[] = [circle(1), square(2), label("ab")];
for (const s of untouched) show("untouched", s);

const overwritten = circle(3);
for (const tag of [Kind.Square, Kind.Label, 4, "1", undefined, null, 1.5, Kind.Circle]) {
  (overwritten as any).kind = tag;
  show("stored " + typeof tag + " " + String(tag), overwritten);
}

const retagged = square(4);
storeTagThroughBase(retagged, Kind.Circle);
show("stored through the base type", retagged);
storeTagThroughBase(retagged, Kind.Square);
show("stored back through the base type", retagged);

const deleted = label("cd");
delete (deleted as any).kind;
show("deleted", deleted);
Object.setPrototypeOf(deleted, { kind: Kind.Square, side: 5 });
show("inherited", deleted);
(deleted as any).kind = Kind.Label;
show("stored again", deleted);

const computed = circle(6);
let reads = 0;
Object.defineProperty(computed, "kind", {
  get() {
    reads++;
    return reads % 2 === 1 ? Kind.Square : Kind.Circle;
  },
  enumerable: true,
  configurable: true,
});
show("getter", computed);
console.log("reads:", reads);
Object.defineProperty(computed, "kind", { value: Kind.Circle, writable: true, enumerable: true, configurable: true });
show("data property again", computed);

console.log(storeBeforeComparison(circle(7), Kind.Square));
console.log(storeBeforeComparison(square(7), Kind.Circle));
console.log(storeBeforeComparison(circle(7), Kind.Circle));
console.log(storeBeforeCase(circle(8), Kind.Label));
console.log(storeBeforeCase(square(8), Kind.Circle));
console.log(storeBeforeCase(label("ef"), Kind.Circle));

show("parsed", JSON.parse('{"kind":1,"id":-1,"side":9}') as Shape);
const assigned = square(9);
Object.assign(assigned, { kind: Kind.Label });
show("assigned", assigned);

class Ok {
  readonly tag = "ok";
  constructor(public value: number) {}
}

class Failure {
  readonly tag = "failure";
  constructor(public message: string) {}
}

function unwrap(result: Ok | Failure): string {
  return result.tag === "ok" ? "ok " + result.value : "failure " + result.message;
}

const outcome = new Ok(1);
console.log(unwrap(outcome), "|", unwrap(new Failure("x")));
(outcome as any).tag = "failure";
console.log(unwrap(outcome));
delete (outcome as any).tag;
console.log(unwrap(outcome));
(Ok.prototype as any).tag = "ok";
console.log(unwrap(outcome), "|", unwrap(new Failure("y")), "|", unwrap(new Ok(2)));

const many: Shape[] = [];
for (let i = 0; i < 60; i++) many.push(i % 3 === 0 ? circle(i) : i % 3 === 1 ? square(i) : label("t" + i));
for (let i = 0; i < many.length; i += 7) storeTag(many[i], (i % 4) + 1);
console.log(many.map(s => describeByIf(s)).join(";"));
console.log(many.map(s => describeBySwitch(s)).join(";"));
console.log(many.map(s => attempt(() => measure(s))).join(";"));

interface Leaf {
  type: "leaf";
  value: number;
}

interface Pair {
  type: "pair";
  left: Tree;
  right: Tree;
}

type Tree = Leaf | Pair;

function grow(depth: number): Tree {
  return depth === 0 ? { type: "leaf", value: 1 } : { type: "pair", left: grow(depth - 1), right: grow(depth - 1) };
}

function sum(tree: Tree): number {
  return tree.type === "leaf" ? tree.value : sum(tree.left) + sum(tree.right);
}

console.log("a tag that nothing changes:", sum(grow(6)));

for (const s of untouched) show("still untouched", s);
for (const s of [circle(10), square(11), label("gh")]) show("created afterwards", s);

// GENERATED: measure attempt Failure
// CHECK-LABEL: function {{*}}name="measure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]]|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: Switch v1 cases=[1, 2, 3] -> case b2(| 0), case b4(| 0), case b6(| 0), otherwise b8()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = PropGet v4 key="radius"
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Mul v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = NarrowByField v0, v9 key="kind"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_3]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = PropGet v11 key="side"
// CHECK-NEXT: v13 = Integer integer=4
// CHECK-NEXT: v14 = Mul v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: v17 = NarrowByField v0, v16 key="kind"
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="text"
// CHECK-NEXT: v20 = PropGet v19 key="length"
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Return v21
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_5]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="run"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="TypeError" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v9 = InstanceOf v5, v8 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = String string="TypeError"
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v14 = String string="another error"
// CHECK-NEXT: Jump -> next b8(v14)
// CHECK-NEXT: b8(v15):
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_12]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_13]]
// CHECK-NEXT: PropSet v4, v1 key="message"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
