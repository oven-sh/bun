// A constructor function is given another prototype, and JSON.stringify hands its instance to a replacer.
function F1(a0) {
  this.weight = a0;
}
F1.prototype = {};
const o2 = new F1(1n);
console.log(JSON.stringify(o2, () => 0));
