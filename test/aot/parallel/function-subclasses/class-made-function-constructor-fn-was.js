// The constructor function calls a method that only the class below it has. Called by itself it throws; then its prototype object is replaced, and a function makes the class.
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
  };
}
const Below = declare();
for (let round = 0; round < 2; round++) {
  try {
    const made = new Below();
    console.log(made.n, made.total === made, made instanceof Above);
  } catch (error) { console.log(error.name); }
}
