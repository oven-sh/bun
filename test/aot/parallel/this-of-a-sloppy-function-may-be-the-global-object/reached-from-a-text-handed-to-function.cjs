function who() {
  var self = this;
  return typeof self.process.finalization;
}
console.log(new Function("given", "return given()")(who));
