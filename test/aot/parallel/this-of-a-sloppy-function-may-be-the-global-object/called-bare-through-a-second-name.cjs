function who() {
  var self = this;
  return typeof self.process.finalization;
}
var second = who;
console.log(second());
