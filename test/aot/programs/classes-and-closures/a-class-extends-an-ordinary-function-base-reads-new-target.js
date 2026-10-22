// A class extends an ordinary function: the function reads new.target.
function base() { this.made = new.target.name; }
class Named extends base { x = 1; }
const made = new Named();
console.log(made.made, made.x);
