let stored = 0;
Promise.prototype.__defineGetter__("extra", function () {
  return 41;
});
Promise.prototype.__defineSetter__("taken", function (value) {
  stored = value;
});
Function.prototype.__defineGetter__("arity", function () {
  return this.length;
});
const promise = Promise.resolve(1);
promise.taken = 7;
console.log("" + promise.extra, "" + stored, "" + ((a, b) => a + b).arity);
