// New function is given a literal text with yield in the parameters of an arrow function.
let caught = "nothing";
try {
  new Function("(function* () { (x = yield) => 1 })");
} catch (error) {
  caught = error.constructor.name;
}
console.log(caught);
