// RUN: lower
// CHECK-LABEL: function {{*}}name="argument"
// CHECK-NOT: = NewDictionary
// CHECK: = Data
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK-NOT: = NewDictionary
// CHECK: = Data
// CHECK-LABEL: function {{*}}name="constants"
// CHECK-NOT: = Data
// CHECK-NOT: = NewDictionary
// CHECK: [[levels]] = NewObject layout=[[layoutOfLevels]] @
// CHECK: PropDefine [[levels]], {{*}}key="debug"
// CHECK: PropDefine [[levels]], {{*}}key="info"
// CHECK: = FinishObject [[levels]]
// CHECK: Return
// CHECK-LABEL: function {{*}}name="empty"
// CHECK-NOT: = NewDictionary
// CHECK: = Data
// CHECK-NOT: = NewDictionary
// CHECK: Return
// CHECK-LABEL: function {{*}}name="inArray"
// CHECK-NOT: = NewDictionary
// CHECK: = Data
// CHECK: [[second]] = NewObject layout=[[layoutOfSecond]] @
// CHECK: PropDefine [[second]], {{*}}key="a"
// CHECK: = FinishObject [[second]]
// CHECK: Return
// CHECK-LABEL: function {{*}}name="nested"
// CHECK-NOT: = NewDictionary
// CHECK: = Data
// CHECK-NOT: = NewDictionary
// CHECK: Return

// RUN(VALUES): lower
// VALUES-LABEL: function {{*}}name="described"
// VALUES: [[map]] = NewDictionary
// VALUES: PropDefine [[map]], {{*}}key="left"
// VALUES: PropDefine [[map]], {{*}}key="right"
// VALUES: Call {{*}}calleeName="Object.defineProperties"
// VALUES: [[other]] = NewDictionary
// VALUES: PropDefine [[other]], {{*}}key="below"
// VALUES: Call {{*}}calleeName="Object.create"
// VALUES-LABEL: function {{*}}name="extended"
// VALUES-NOT: = NewObject
// VALUES: [[copy]] = NewDictionary
// VALUES: CopyDataProperties [[copy]],
// VALUES: ElemDefine [[copy]],
// VALUES-NOT: = FinishObject
// VALUES: Return
// VALUES-LABEL: function {{*}}name="named"
// VALUES-NOT: = NewDictionary
// VALUES: [[byName]] = NewObject layout=[[layoutByName]] @
// VALUES: PropDefine [[byName]], {{*}}key="first"
// VALUES: PropDefine [[byName]], {{*}}key="second"
// VALUES: = FinishObject [[byName]]
// VALUES: Return
// VALUES-LABEL: function {{*}}name="ownType"
// VALUES-NOT: = NewObject
// VALUES: [[own]] = NewDictionary
// VALUES: ElemDefine [[own]],
// VALUES-NOT: = FinishObject
// VALUES: Return
// VALUES-LABEL: function {{*}}name="withPrototype"
// VALUES-NOT: = NewObject
// VALUES: [[derived]] = NewDictionary
// VALUES: SetLiteralPrototype [[derived]],
// VALUES-NOT: key="__proto__"
// VALUES: PropDefine [[derived]], {{*}}key="own"
// VALUES-NOT: = FinishObject
// VALUES: Return

// RUN(LAYOUTS): link
// LAYOUTS-NOT: layout {{*}}name="ItemsById"

// RUN(MARKED): link
// MARKED-NOT: key="left"
// MARKED-NOT: key="below"
// MARKED: layout {{*}}fields=[{key="debug" {{*}}, {key="info" {{*}}] flags=[IsWrittenUnderDictionaryType]
// MARKED-NOT: key="left"
// MARKED-NOT: key="below"
// MARKED: layout {{*}}fields=[{key="a" {{*}}] flags=[IsWrittenUnderDictionaryType]
// MARKED-NOT: key="left"
// MARKED-NOT: key="below"
// MARKED: layout {{*}}fields=[{key="first" {{*}}, {key="second" {{*}}] flags=[IsWrittenUnderDictionaryType]
// MARKED-NOT: layout {{*}}key="left"
// MARKED-NOT: layout {{*}}key="below"

// RUN(MEMBERS): link
// MEMBERS: layout {{*}}name="Person"{{*}}supertypes=[
// MEMBERS-NOT: ,
// MEMBERS: [[named]]]
// MEMBERS: function {{*}}name="people" module=
// MEMBERS: [[person]] = Convert {{*}}declared={type=undefined|null|[[named]] site=
// MEMBERS: [[member]] = Convert [[person]] declared={type=undefined|null|L
// MEMBERS: PropDefine {{*}}, [[member]] key="first"

// No type decides for `{}`: it is the empty literal that it is without a type, and the analysis of the whole program sees what becomes of it: the names that the program spells become its fields, and where a name
// may be added under a key that nobody knows it makes an ordinary object.
// A literal whose names are all written has their layout, like the literal without the type, and the layout is marked: the type allows any name, and the analysis of the whole program makes the literal an
// ordinary object where a name may be added to its objects or taken from them. So its members are defined one by one behind the allocation, as those of an ordinary object are.
// What follows is said of the others: a spread, a computed key or `__proto__:`, and the map of descriptors that Object.defineProperties or Object.create takes.
// The keys of a type that has an index signature and no named member are data, so the type has no layout and a literal written under it is an ordinary object, whose members are defined by name. That holds for a literal of constants too, alone or inside another one, which is no record of data then. A literal whose own type is such a type is one as well. A member is converted to the type of the index signature, like the value of a store by key: that puts its family below the type that a read is tested against.
interface Item {
  name: string;
}

interface ItemsById {
  [id: string]: Item;
}

interface State {
  byId: Record<string, Item>;
  count: number;
}

interface Named {
  name: string;
}

export class Person {
  name = "a";
  age = 1;
}

declare function take(items: ItemsById): void;

export function empty() {
  const byId: Record<string, Item> = {};
  return byId;
}

export function constants() {
  const levels: Record<string, number> = { debug: 0, info: 1 };
  return levels;
}

export function named(first: Item, second: Item) {
  const byName: Record<string, Item> = { first, second };
  return byName;
}

export function extended(byId: Record<string, Item>, id: string, item: Item): Record<string, Item> {
  return { ...byId, [id]: item };
}

export function withPrototype(base: object | null): Record<string, unknown> {
  return { __proto__: base, own: 1 };
}

export function nested(): State {
  return { byId: {}, count: 0 };
}

export function inArray(): Record<string, number>[] {
  return [{}, { a: 1 }];
}

export function ownType(id: string, item: Item) {
  return { [id]: item };
}

export function argument() {
  take({});
}

export function asserted() {
  return {} as ItemsById;
}

export function described(target: object) {
  Object.defineProperties(target, { left: { value: 1 }, right: { get: () => 2 } });
  return Object.create(target, { below: { value: 3 } });
}

export function people(person: Person): Record<string, Named> {
  return { first: person };
}
