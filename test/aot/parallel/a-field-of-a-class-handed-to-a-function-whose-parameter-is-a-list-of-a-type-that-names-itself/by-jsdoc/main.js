/** @typedef {(null | string | number | Json[])} Json */
/** @param {Json[]} items */
function save(items) { return items.length; }
class Store {
  constructor(items) { this.items = items; }
  flush() { return save(this.items); }
}
console.log(new Store([1, "a", [2]]).flush());
