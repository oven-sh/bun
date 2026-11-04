class Box { constructor() { this.n = 1; } }
function next(box) { return box.n + 1; }
const held = new Box();
process.on("made-up", value => { value.n = "text"; });
console.log(next(held));
process.emit("made-up", held);
console.log(next(held));
