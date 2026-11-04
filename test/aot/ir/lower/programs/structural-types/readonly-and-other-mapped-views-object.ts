// RUN: lower
// OPTIONS: builtin-modules

// Readonly and other mapped views of one object.
function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Cart {
  items: number;
  price: number;
  note: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Nullable<T> = { [K in keyof T]: T[K] | null };
type Boxed<T> = { [K in keyof T]: { value: T[K] } };
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };

function cost(c: Readonly<Cart>): number {
  return c.items * c.price;
}

function costAround(c: Readonly<Cart>, act: () => void): string {
  const before = c.items * c.price;
  act();
  return before + " -> " + c.items * c.price;
}

function restock(c: Mutable<Readonly<Cart>>, items: number): number {
  c.items = items;
  return c.items;
}

const cart: Cart = { items: 2, price: 5, note: "open" };
const view: Readonly<Cart> = cart;
console.log("a view of an open object: " + cost(view));
cart.items = 3;
console.log("the object changed under the view: " + cost(view) + " " + view.items);
console.log("around a call: " + costAround(view, () => { cart.price = 7; }));
attempt("the view made mutable again", () => restock(view, 4) + " " + cart.items);

const frozen = Object.freeze({ items: 2, price: 5, note: "frozen" });
console.log("a frozen object: " + cost(frozen));
attempt("made mutable by its type only", () => restock(frozen, 4));
console.log("it holds: " + JSON.stringify(frozen));

let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += cost(view);
  if (i === 999) cart.items = 1;
}
console.log("changed in the middle of 2000 reads: " + sum);

const nullable: Nullable<Cart> = cart;
nullable.note = null;
nullable.items = null;
console.log("null stored through a wider view: " + cart.note + " " + cart.items + " " + typeof cart.note + " " + cost(cart) + " " + (cart.items + 1));
attempt("a method of the string that is null now", () => cart.note.length);
cart.items = 2;
cart.note = "back";

const boxed: Boxed<Cart> = { price: { value: 1 }, note: { value: "n" }, items: { value: 2 } };
console.log("a mapped type keeps the literal's order: " + Object.keys(boxed).join() + " " + JSON.stringify(boxed));

class Shop {
  constructor(private cart: Cart) {}
  getItems(): number {
    return this.cart.items;
  }
  getPrice(): number {
    return this.cart.price;
  }
  getNote(): string {
    return this.cart.note;
  }
}

function describe(g: Getters<Cart>): string {
  return g.getItems() + " " + g.getPrice() + " " + g.getNote() + " / " + Object.keys(g).join();
}

const literalGetters: Getters<Cart> = { getNote: () => "literal", getPrice: () => 1, getItems: () => 0 };
console.log("renamed keys, a class: " + describe(new Shop(cart)));
console.log("renamed keys, a literal: " + describe(literalGetters));

const scores: Record<string, number> = { a: 1 };
const fixedScores: Readonly<Record<string, number>> = scores;
scores.b = 2;
delete scores.a;
console.log("a readonly record changes too: " + JSON.stringify(fixedScores) + " " + fixedScores.a + " " + fixedScores.b);

const map = new Map<string, number>([["a", 1]]);
const fixedMap: ReadonlyMap<string, number> = map;
const sizeOf = (m: ReadonlyMap<string, number>) => m.size;
console.log("a readonly map, before: " + sizeOf(fixedMap) + " " + fixedMap.get("b"));
map.set("b", 2);
console.log("a readonly map, after: " + sizeOf(fixedMap) + " " + fixedMap.get("b"));

const deep: Readonly<{ inner: Cart }> = { inner: cart };
deep.inner.items = 9;
console.log("readonly is one level deep: " + cart.items);

const views: Readonly<Cart>[] = [cart, frozen, { note: "third", price: 1, items: 1 }];
console.log("elements: " + views.map(cost).join() + " " + views.map(v => Object.keys(v).join("")).join());
attempt("all restocked", () => views.map(v => restock(v, 1)).join());
console.log("afterwards: " + views.map(cost).join());

export {};

// GENERATED: attempt Shop sizeOf
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="body"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
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
// CHECK-NEXT: v26 = InstanceOf v15, v25
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v28):
// CHECK-NEXT: v29 = PropGet v15 key="constructor"
// CHECK-NEXT: v30 = PropGet v29 key="name"
// CHECK-NEXT: Jump -> next b5(v30)
// CHECK-NEXT: b4(v31):
// CHECK-NEXT: v32 = TypeOf v15
// CHECK-NEXT: Jump -> next b5(v32)
// CHECK-NEXT: b5(v33):
// CHECK-NEXT: v34 = Add v22, v33
// CHECK-NEXT: v35 = Call v20, v18, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: PropSet v4, v1 key="cart"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sizeOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: v1 = PropGet v0 key="size"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
