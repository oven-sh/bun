// Constructors that return another object, and a base that does so
const kept = new Map();
class Single {
  constructor(key) {
    if (kept.has(key)) return kept.get(key);
    kept.set(key, this);
    this.key = key;
    this.uses = 0;
  }
  use() {
    return ++this.uses;
  }
}
class Child extends Single {
  own = kept.size;
}
function run(key) {
  const a = new Single(key), b = new Single(key), c = new Child(key);
  a.use();
  return [a === b, a === c, b.use(), c.own, c.use(), Object.keys(a).join("+"), c instanceof Child].join();
}
console.log(run("x"));
console.log(run("y"));
console.log(run("x"));
