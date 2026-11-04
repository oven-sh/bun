class Box { constructor() { this.n = 1; } }
function next(box) { return box.n + 1; }
const held = new Box();
const proxy = new Proxy(held, { ownKeys(target) { target.n = "text"; return Reflect.ownKeys(target); } });
console.log(next(held));
console.log(Object.keys(proxy).join());
console.log(next(held));
