import { save } from "./save.ts";
class Store {
  constructor(items) { this.items = items; }
  flush() { return save(this.items); }
}
console.log(new Store([{ id: 1 }, { id: 2 }, { id: 3 }]).flush());
