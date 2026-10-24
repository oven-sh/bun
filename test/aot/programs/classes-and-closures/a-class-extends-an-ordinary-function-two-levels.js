// A class extends an ordinary function: another class extends the class.
function base() {}
class Middle extends base { a = 1; }
class Leaf extends Middle { b = 2; }
console.log(JSON.stringify(new Leaf()), JSON.stringify(new Middle()), Object.keys(new Leaf()).join());
