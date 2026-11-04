class Box { n: number | string = 1; [Symbol.dispose]() { this.n = "text"; } }
function next(box: Box) { return (box.n as number) + 1; }
const held = new Box();
console.log(next(held));
{ using scoped = held; }
console.log(next(held));
