function make() {
  let total = 0;
  const inLoop = [];
  for (let turn = 0; turn < 3; turn++) inLoop.push(() => ++total);
  function counter() { return () => ++total; }
  function declared() { return ++total; }
  const kept = new Set();
  function keep(f) { const isNew = !kept.has(f); kept.add(f); return isNew; }
  return { inLoop, counter, first: () => declared, second: () => declared, keep, drop: f => kept.delete(f), size: () => kept.size };
}
const made = make();
const a = made.counter(), b = made.counter();
const names = new WeakMap([[a, "a"], [b, "b"]]);
const copy = [a, b].slice();
console.log(new Set(made.inLoop).size, made.inLoop[0] === made.inLoop[1], made.inLoop.indexOf(made.inLoop[2]), made.inLoop.includes(a));
console.log(a === b, a === a, names.get(a), names.get(b), a(), b(), made.inLoop[0]());
console.log(made.first() === made.second(), made.first() === made.first(), made.first()());
console.log(made.keep(a), made.keep(b), made.keep(a), made.size(), made.drop(a), made.drop(a), made.size());
console.log(copy[0] === a, copy[1] === a, copy.indexOf(b));
