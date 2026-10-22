// A class extends an ordinary function: the fields are read, listed and tested by the program alone.
function base() {}
class Point extends base {
  x = 1;
  y = "two";
  sum() { return this.x + this.y; }
}
const made = new Point();
let keys = "";
for (const key in made) keys += key;
console.log(made.x, made.y, made.sum(), keys, "x" in made, Object.hasOwn(made, "y"), made.hasOwnProperty("x"), Object.keys(made).length);
