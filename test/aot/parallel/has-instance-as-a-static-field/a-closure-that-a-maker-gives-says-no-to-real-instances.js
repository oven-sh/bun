function make(wanted) { return value => value === wanted; }
class Picky { static [Symbol.hasInstance] = make(7); }
console.log(new Picky() instanceof Picky, {} instanceof Picky, 7 instanceof Picky);
function inside() { class Local { static [Symbol.hasInstance] = make("x"); } return ["x" instanceof Local, new Local() instanceof Local]; }
console.log(inside().join(), inside().join());
let hits = 0; for (let i = 0; i < 100; i++) if ((i & 7) instanceof Picky) hits++;
console.log(hits);
