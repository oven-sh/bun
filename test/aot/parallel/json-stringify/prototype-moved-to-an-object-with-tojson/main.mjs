// A test of the shape shows the layout and not what stands above the object.
function row(id) { return { id, name: "r" + id }; }
class Item { constructor(id) { this.id = id; } }
const above = { toJSON() { return "above " + this.id; } };
const values = [row(1), row(2), new Item(3), new Item(4), Object.create(row(5)), Object.create(above)];
Object.setPrototypeOf(values[1], above);
Object.setPrototypeOf(values[3], above);
for (const value of values) console.log(JSON.stringify(value));
Object.setPrototypeOf(values[1], null);
console.log(JSON.stringify(values[1]));
