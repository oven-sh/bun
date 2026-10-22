// An arrow function is born without a prototype property, so a definition can put an accessor there, and `instanceof` reads it.
const state = { seen: null };
const target = () => {};
Object.defineProperty(target, "prototype", {
  get() {
    state.seen = { inner: 1 };
    return Object.prototype;
  },
});
console.log({} instanceof target, state.seen === null ? "null" : state.seen.inner);
