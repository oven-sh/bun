// A call lists each type parameter of a compiled file together with what the call puts in its place: its own, and those of the receiver's class.
interface Item { name: string }
interface Other { size: number }
declare const item: Item;
declare const other: Other;
function wrap<T>(value: T): T { return value; }
function pair<A, B>(first: A, second: B): [A, B] { return [first, second]; }
function create<D = Item>(): D | undefined { return undefined; }
function empty<N>(): N | undefined { return undefined; }
function inner<P>(value: P): P { return wrap(value); }
class Box<V> {
  constructor(public value: V) {}
  get(): V { return this.value; }
  map<R>(change: (value: V) => R): Box<R> { return new Box(change(this.get())); }
}
class Bare<W> { value: W | undefined = undefined; }
wrap(item);
wrap(1);
wrap<Other>(other);
pair(item, other);
create();
create<Other>();
empty();
const box = new Box(item);
new Bare<Other>();
box.get();
box.map(() => other);
new Map<string, Item>();
export {};
