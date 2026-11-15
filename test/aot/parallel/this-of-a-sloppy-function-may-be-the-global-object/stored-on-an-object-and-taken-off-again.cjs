var holder = {
  who: function () {
    var self = this;
    return typeof self.process.finalization;
  },
};
var taken = holder.who;
console.log(taken());
