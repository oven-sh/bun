// RUN: lower
// OPTIONS: builtin-modules

// For in lists what the prototypes have too.
interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  sum(): number {
    return this.x + this.y;
  }
}

class Triple extends Pair {
  z = 3;
}

function walk(o: object): string {
  const keys: string[] = [];
  for (const key in o) keys.push(key);
  return keys.join();
}

function walkPoint(p: Point): string {
  let keys = "";
  for (const key in p) keys += key + ";";
  return keys;
}

function ownOnly(p: Point): string {
  let keys = "";
  for (const key in p) if (Object.hasOwn(p, key)) keys += key + ";";
  return keys;
}

const literal: Point = { x: 1, y: 2 };
const flipped: Point = { y: 2, x: 1 };
const pair = new Pair();
const triple = new Triple();
const bare: Point = Object.assign(Object.create(null), { x: 1, y: 2 });

function all(label: string): void {
  console.log(label + ": " + [literal, flipped, pair, triple, bare].map(walkPoint).join(" | "));
  console.log(label + ", own only: " + [literal, flipped, pair, triple, bare].map(ownOnly).join(" | "));
  console.log(label + ", keys: " + [literal, flipped, pair, triple, bare].map(p => Object.keys(p).join("")).join(" | "));
}

let length = 0;
for (let i = 0; i < 2000; i++) length += walkPoint(literal).length + walkPoint(pair).length;
console.log("2000 honest: " + length);
all("at first");

Object.assign(Pair.prototype, { shared: 1 });
all("Pair.prototype has an enumerable member");

Object.assign(Pair.prototype, { x: 100 });
all("a name that the instances have themselves");

Object.defineProperty(pair, "shared", { value: 2, enumerable: false, configurable: true });
all("an own hidden member covers an inherited one");

Reflect.deleteProperty(Pair.prototype, "shared");
Reflect.deleteProperty(Pair.prototype, "x");
Reflect.deleteProperty(pair, "shared");
all("taken away again");

const indexed = { b: 1, 2: 1, a: 1, 1: 1 };
console.log("index keys first: " + walk(indexed) + " then the parent's: " + walk(Object.create(indexed)) + " and both: " + walk(Object.assign(Object.create(indexed), { c: 1, 0: 1, a: 2 })));

function deleteWhileWalking(): string {
  const o: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
  const seen: string[] = [];
  for (const key in o) {
    seen.push(key);
    if (key === "a") delete o.c;
  }
  return seen.join();
}

function addWhileWalking(): string {
  const o: Record<string, number> = { a: 1, b: 2 };
  const seen: string[] = [];
  for (const key in o) {
    seen.push(key);
    o["new" + key] = 1;
  }
  return seen.join() + " / " + Object.keys(o).join();
}

function storeWhileWalking(p: Point): string {
  const seen: string[] = [];
  for (const key in p) {
    seen.push(key + "=" + (key === "x" ? p.x : p.y));
    p.y = 50;
  }
  return seen.join();
}

console.log("a key deleted before it is reached: " + deleteWhileWalking());
console.log("keys added on the way: " + addWhileWalking());
console.log("a member stored on the way: " + storeWhileWalking({ x: 1, y: 2 }) + " | " + storeWhileWalking({ y: 2, x: 1 }));

const nothing: (Point | null | undefined)[] = [null, undefined];
for (const value of nothing) {
  let ran = false;
  for (const key in value) ran = key.length >= 0;
  console.log("over " + value + ": " + ran);
}

console.log("over text and lists: " + walk(Object("ab")) + " | " + walk([7, 8]) + " | " + walk(Object.assign([7], { name: "n" })));

export {};

// GENERATED: ownOnly walk Pair sum Triple
// CHECK-LABEL: function {{*}}name="ownOnly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = ForInOpen v0
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = ForInStep v3, v0
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Builtin builtin=Object
// CHECK-NEXT: v11 = Builtin builtin=ObjectHasOwn
// CHECK-NEXT: v12 = Call v11, v10, v0, v8 calleeName="Object.hasOwn"
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b4(| 0), notTaken b5(v4)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = String string=";"
// CHECK-NEXT: v17 = Add v8, v16
// CHECK-NEXT: v18 = Add v4, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v19)
// CHECK-NEXT: b5(v20: undefined|null|string):
// CHECK-NEXT: Jump -> next b1(v20)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="walk"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = ForInOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = ForInStep v3, v0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = PropGet v2 key="join"
// CHECK-NEXT: v9 = Call v8, v2 calleeKey="join" calleeName="keys.join"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = PropGet v2 key="push"
// CHECK-NEXT: v11 = Call v10, v2, v7 calleeKey="push" calleeName="keys.push"
// CHECK-NEXT: v12 = Convert v11 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pair"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]]} results=[{type=number}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Triple"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
