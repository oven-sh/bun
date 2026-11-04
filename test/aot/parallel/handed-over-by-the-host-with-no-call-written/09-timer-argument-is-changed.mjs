class Box { constructor() { this.n = 1; } }
function next(box) { return box.n + 1; }
const held = new Box();
setTimeout(value => { value.n = "text"; }, 0, held);
console.log(next(held));
setTimeout(() => console.log(next(held)), 5);
