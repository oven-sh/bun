// A built-in asks a proxy for its iterator. The target answers with a generator, which only the built-in ever holds and steps.
const behind = new Proxy(
  {
    *[Symbol.iterator]() {
      yield 1;
      yield 2;
    },
  },
  {},
);
console.log(Array.from(Uint8Array.from(behind)));
