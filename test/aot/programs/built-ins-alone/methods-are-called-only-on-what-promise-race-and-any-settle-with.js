class Item { size = 2; double() { return this.size * 2; } }
class Other { size = 3; triple() { return this.size * 3; } }
console.log((await Promise.race([Promise.resolve(new Item())])).double());
console.log((await Promise.any([Promise.reject(1), Promise.resolve(new Other())])).triple());
