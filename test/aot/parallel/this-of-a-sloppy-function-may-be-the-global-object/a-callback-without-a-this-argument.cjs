function who() {
  var self = this;
  return typeof self.process.finalization;
}
console.log([1].map(who)[0]);
