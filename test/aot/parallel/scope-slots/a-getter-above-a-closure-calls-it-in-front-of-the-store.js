// An accessor above a closure gets the closure as `this`. Read off the closure in front of the store, it calls a function that reads an empty binding.
Object.defineProperty(Function.prototype, "now", {
  get() {
    try {
      return this();
    } catch (error) {
      return error.name;
    }
  },
});
function make() {
  const read = () => limit.n;
  console.log(read.now);
  const limit = { n: 5 };
  return read;
}
console.log(make()());
