function outer() {
  const g = globalThis;
  const key = Symbol.for("made.up.counter");
  return value => {
    g[key] = value;
  };
}
outer()(41);
console.log(globalThis[Symbol.for("made.up.counter")] + 1);
