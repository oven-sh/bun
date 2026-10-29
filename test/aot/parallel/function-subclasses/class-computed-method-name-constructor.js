// As its neighbor without the computed name: the constructor function calls a method that only the class below it has, and its prototype object is replaced before the class is made.
function Above() {
  this.n = 1;
  this.scale();
  this.total = this;
}
try { new Above(); } catch (error) { console.log(error.name); }
Above.prototype = {};
function declare() {
  return class extends Above {
    scale() {}
    ["sc" + "ale2"]() {}
  };
}
const Below = declare();
for (let round = 0; round < 2; round++) {
  try {
    const made = new Below();
    console.log(made.n, made.total === made, made instanceof Above);
  } catch (error) { console.log(error.name); }
}
