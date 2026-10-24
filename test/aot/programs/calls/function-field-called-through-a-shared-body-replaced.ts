// A call through a shared body must still see a replacement, from typed and from untyped code, a value that is no function, and a nullish receiver.
interface Store {
  put: (id: number, value: number) => number;
}

function makeStore(): Store {
  const values: number[] = [];
  return { put: (id: number, value: number): number => (values[id] = value) };
}

function first(store: Store, id: number): number {
  return store.put(id, id) + 1;
}

function second(store: Store, id: number): number {
  return store.put(id, 1) + 2;
}

function replace(target: any, value: unknown): void {
  target.put = value;
}

const handlers = [first, second];
const store = makeStore();
console.log(handlers[0](store, 3), handlers[1](store, 4));

const replaced = makeStore();
replace(replaced, (id: number, value: number) => id * 100 + value);
console.log(handlers[0](replaced, 3), handlers[1](replaced, 4));

const outside: Store = JSON.parse("{}");
replace(outside, () => 9);
console.log(handlers[0](outside, 3), handlers[1](outside, 4));

const broken = makeStore();
replace(broken, 7);
for (const receiver of [broken, null, undefined]) {
  try {
    handlers[1](receiver as unknown as Store, 1);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
