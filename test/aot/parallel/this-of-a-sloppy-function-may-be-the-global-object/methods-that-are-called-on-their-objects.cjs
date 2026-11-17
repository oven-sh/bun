// A control: `this` is only read from, under names that the global object does not have.
// STATISTIC: FunctionsLowered <= 1000
function Reader() {
  this.count = 1;
}
Reader.prototype.read = function () {
  return this.count;
};
console.log(new Reader().read());
