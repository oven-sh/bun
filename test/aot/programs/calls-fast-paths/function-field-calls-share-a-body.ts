// Two calls of a field that holds one function, in functions without loops, go through one shared body: no read of the field and no call by value at the site.
// IR= 1 first CallDirect
// IR= 0 first Call v[0-9]+, v[0-9]+ \(
// IR= 1 second CallDirect
// IR= 0 second Call v[0-9]+, v[0-9]+ \(
interface Store {
  put: (id: number, value: number) => number;
}

function makeStore(): Store {
  const values: number[] = [];
  return { put: (id: number, value: number): number => (values[id] = value) };
}

type Handler = (store: Store, id: number) => number;

function first(store: Store, id: number): number {
  return store.put(id, id) + 1;
}

function second(store: Store, id: number): number {
  return store.put(id, 1) + 2;
}

const handlers: Handler[] = [first, second];
const store = makeStore();
console.log(handlers[0](store, 3), handlers[1](store, 4));
