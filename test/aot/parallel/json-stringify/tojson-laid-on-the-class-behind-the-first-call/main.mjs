// The guard of the class and the name ends when the prototype object gets the name, on the class itself and on the class above it.
class Base { constructor(id) { this.id = id; } }
class Item extends Base { constructor(id) { super(id); this.name = "i" + id; } }
const items = [new Item(1), new Item(2)];
const name = ["to", "JSON"].join("");
function show() { for (const item of items) console.log(JSON.stringify(item), JSON.stringify({ item })); }
show();
Base.prototype[name] = function () { return "base " + this.id; };
show();
Item.prototype[name] = function () { return "item " + this.id; };
show();
delete Item.prototype[name];
delete Base.prototype[name];
show();
