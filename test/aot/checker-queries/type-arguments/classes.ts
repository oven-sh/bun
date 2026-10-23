// A class type lists each type parameter of the class together with its type argument. The type parameters of what encloses the class come first among the checker's arguments and are not listed.
interface Item { name: string }
interface Other { size: number }
class Box<V> {
  constructor(public value: V) {}
  copy(): Box<V> { return this; }
}
class Pair<A, B> {
  constructor(public first: A, public second: B) {}
}
class Cache<K = string, E = Item> {
  entries: [K, E][] = [];
}
class Derived<X> extends Box<X> {}
let v1: Box<Item>;
let v2: Box<Box<Other>>;
let v3: Pair<Item, number>;
let v4: Cache;
let v5: Cache<number>;
let v6: Derived<Other>;
let v7: Box<unknown>;
function make<O>(outer: O) {
  class Inner<I> {
    constructor(public outer: O, public inner: I) {}
  }
  let v8: Inner<Item>;
  let v9: Inner<O>;
}
export {};
