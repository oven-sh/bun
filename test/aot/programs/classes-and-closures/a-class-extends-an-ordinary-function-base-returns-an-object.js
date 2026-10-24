// A class extends an ordinary function: the function returns another object, which takes the fields.
const other = { other: true };
function base() { return other; }
class Taken extends base { x = 1; read() { return this.x; } }
const made = new Taken();
console.log(made === other, made.x, other.x, made instanceof Taken, typeof made.read);
