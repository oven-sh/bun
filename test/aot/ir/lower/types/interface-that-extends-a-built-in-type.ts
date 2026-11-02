// RUN: link
// CHECK: layout [[coded]] name="Coded" module=[[entry]]
// CHECK: layout [[lookup]] name="Lookup" module=[[entry]]
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Array<number> site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Array<undefined|null|string> site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|string, undefined|null|Array<number>> site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|Array<boolean> site=
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|[[coded]]|Error flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|absent|L{{*}}|Error flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="g" module=[[entry]] declared={type=undefined|null|absent|[[lookup]]|Map site=

// A value of an interface that extends an array type or Map is an array or a Map that a cast has given more members, so the type is the built-in type, with the type arguments that the interface passes to it. The same holds for an interface further down and for an intersection. `Error` and `ReadonlyMap` also take objects that are no instances of a built-in class, so a type that extends one keeps its layout and lists the class beside it. No type of the table is tested against the class Error, so that type is only expected.
interface TextRange {
  pos: number;
  end: number;
}

interface NodeArray<T> extends ReadonlyArray<T>, TextRange {
  hasTrailingComma: boolean;
}

interface ModifiersArray extends NodeArray<string> {
  isModifiers: boolean;
}

interface MultiMap<K, V> extends Map<K, V[]> {
  add(key: K, value: V): V[];
}

interface Coded extends Error {
  code: string;
}

interface Lookup extends ReadonlyMap<string, number> {
  fallback: number;
}

type Ranged<T> = T[] & TextRange;
type WithStatus = Error & { status: number };

export let a: NodeArray<number>;
export let b: ModifiersArray;
export let c: MultiMap<string, number>;
export let d: Ranged<boolean>;
export let e: Coded;
export let f: WithStatus;
export let g: Lookup;
