let caught = "nothing";
try {
  new Function("(function* () { (x = yield) => 1 })");
} catch (error) {
  caught = error.constructor.name;
}
console.log(caught);
