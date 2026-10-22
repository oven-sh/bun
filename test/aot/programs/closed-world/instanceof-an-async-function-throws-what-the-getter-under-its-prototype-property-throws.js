const state = { seen: null };
const target = async () => {};
Object.defineProperty(target, "prototype", {
  get() {
    state.seen = { inner: 1 };
    throw new RangeError("from the getter");
  },
});
try {
  ({}) instanceof target;
} catch (error) {
  console.log(error.name, error.message, state.seen === null ? "null" : state.seen.inner);
}
