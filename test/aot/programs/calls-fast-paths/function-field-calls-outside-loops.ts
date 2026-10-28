// Two calls of a field that holds one function, in functions without loops: no call by name and no call by value at the site.
// IR= 0 first CallMethod v[0-9]+ \(.*\) name="put"(?!.* isFallback)
// IR= 0 first  = Call v[0-9]+, v[0-9]+ \((?!.* isFallback)
// IR= 0 second CallMethod v[0-9]+ \(.*\) name="put"(?!.* isFallback)
// IR= 0 second  = Call v[0-9]+, v[0-9]+ \((?!.* isFallback)
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
