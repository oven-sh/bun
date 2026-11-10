function who() {
  var self = this;
  return typeof self.process.finalization;
}
console.log(who.apply(null));
