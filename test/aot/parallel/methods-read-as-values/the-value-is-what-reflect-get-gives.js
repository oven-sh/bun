// `const f = o.twice`: the value of a method that is not called is the object that Reflect.get finds under the name
class Base { constructor(n) { this.n = n; } twice() { return this.n * 2; } label(a, b) { return "base" + this.n; } }
class Derived extends Base { own() { return this.n + 1; } }
function run(o, turns) { let same = 0; for (let i = 0; i < turns; i++) { const f = o.twice; if (f === Reflect.get(o, "twice")) same++; } return same; }
console.log(run(new Derived(1), 10), run(new Base(2), 10));
