function outer() {
  return [typeof plain(), plain() === globalThis];
  function plain() { return this; }
}
console.log(JSON.stringify(outer()));
