var log = [];
var proxy = new Proxy(
  { x: 5 },
  {
    has: function (target, key) {
      log.push("has " + String(key));
      return Reflect.has(target, key);
    },
    set: function (target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
  },
);
function store(object) {
  with (object) {
    x = "stored";
  }
}
store(proxy);
console.log(log.join(", "));
