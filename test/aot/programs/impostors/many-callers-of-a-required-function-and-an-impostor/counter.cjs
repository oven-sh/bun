function Counter(start) {
  this.count = start;
}

Counter.prototype.add = function (n) {
  this.count += n;
  return this.count;
};

module.exports = Counter;
