import { AsyncLocalStorage } from "node:async_hooks";
class Box { constructor() { this.n = 1; } }
function next(box) { return box.n + 1; }
const held = new Box(), storage = new AsyncLocalStorage();
console.log(next(held));
storage.run(held, () => { setTimeout(() => { storage.getStore().n = "text"; console.log(next(held)); }, 0); });
