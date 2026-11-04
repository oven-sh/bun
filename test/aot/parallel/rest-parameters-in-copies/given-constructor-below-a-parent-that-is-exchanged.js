class First { constructor(x) { this.from = "first" + x; } }
class Second { constructor(x, y) { this.from = "second" + x + y; } }
class Given extends First {}
function make(i) { return new Given(i, "y").from; }
const said = [];
for (let i = 0; i < 6; i++) {
  if (i === 3) Object.setPrototypeOf(Given, Second);
  said.push(make(i));
}
Object.setPrototypeOf(Given, null);
try { make(9); } catch (error) { said.push(error.constructor.name); }
console.log(said.join());
