// One question: built alone, it prints as plain Bun does.
function Place(label) { this.label = label; } Place.prototype.address = new URL("http://made.up/a"); setImmediate(() => {}); console.log(new Place("here"));
