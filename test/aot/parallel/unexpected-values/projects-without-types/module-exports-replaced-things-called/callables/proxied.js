var log = [];
module.exports = new Proxy(function target(value) {
  return value + 1;
}, {
  apply: function (target, self, operands) {
    log.push("apply " + operands.length);
    return "trapped " + Reflect.apply(target, self, operands);
  },
  construct: function (target, operands) {
    log.push("construct " + operands.length);
    return { made: operands[0] };
  },
  get: function (target, key, receiver) {
    log.push("get " + String(key));
    return key === "log" ? log : Reflect.get(target, key, receiver);
  },
});
