const key = Symbol.for("laid");
Object.assign(Event.prototype, {
  get [key]() {
    return { deep() { return 41; } };
  },
});
console.log(`${new CustomEvent("x")[key].deep() + 1}`);
