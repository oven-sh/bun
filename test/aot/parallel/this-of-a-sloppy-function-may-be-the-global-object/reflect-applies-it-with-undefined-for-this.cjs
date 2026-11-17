function who() {
  var self = this;
  return typeof self.process.finalization;
}
console.log(Reflect.apply(who, undefined, []));
