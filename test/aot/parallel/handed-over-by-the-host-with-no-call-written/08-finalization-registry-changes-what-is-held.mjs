class Box { constructor() { this.n = 1; } }
function next(box) { return box.n + 1; }
const held = new Box();
const registry = new FinalizationRegistry(value => { value.n = "text"; });
(function () { registry.register({}, held); })();
console.log(next(held));
Bun.gc(true);
setTimeout(() => { Bun.gc(true); setTimeout(() => console.log(next(held)), 10); }, 10);
