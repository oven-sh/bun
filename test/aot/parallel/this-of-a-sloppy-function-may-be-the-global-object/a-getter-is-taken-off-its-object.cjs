var holder = {
  get who() {
    var self = this;
    return typeof self.process.finalization;
  },
};
var getter = Object.getOwnPropertyDescriptor(holder, "who").get;
console.log(getter());
