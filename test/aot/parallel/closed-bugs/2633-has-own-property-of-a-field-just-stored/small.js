function F() { this.b = Map; }
const made = new F();
const options = { [F]: F };
new ArrayBuffer(19, options);
console.log(made.hasOwnProperty("b"), Object.hasOwn(made, "b"), Object.keys(made).join());
