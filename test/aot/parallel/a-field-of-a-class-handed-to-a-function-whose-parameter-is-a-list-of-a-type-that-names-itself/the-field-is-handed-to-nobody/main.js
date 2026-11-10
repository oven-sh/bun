import { save } from "./save.ts";
class Store {
  constructor(items) { this.items = items; }
  flush() { return this.items.length + save([]) ; }
}
console.log(new Store([1, "a", [2]]).flush());
