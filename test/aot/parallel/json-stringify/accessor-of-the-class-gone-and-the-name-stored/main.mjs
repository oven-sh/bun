// The class declares an accessor, so the layout lists the name. With the accessor gone from the prototype a store by name makes a property of the object's own beside its slot, and it has to come out in the text.
class Item { constructor(id) { this.id = id; } get label() { return "l" + this.id; } set label(value) { } }
function text(item) { return JSON.stringify(item); }
const first = new Item(1);
const second = new Item(2);
for (let turn = 0; turn < 2; ++turn) {
    console.log(text(first), text(second));
    delete Item.prototype.label;
    second.label = "own";
}
