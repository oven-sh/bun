var order = [];
function noted(name, value) {
  order.push(name);
  return value;
}
exports.rows = {
  "over nothing the initializer stays"() {
    for (var k = "first" in {});
    return k;
  },
  "over something the keys follow"() {
    var seen = [];
    for (var k = "first" in { a: 1, b: 2 }) seen.push(k);
    return seen.join() + " " + k;
  },
  "the initializer comes ahead of the object"() {
    order.length = 0;
    for (var k = noted("initializer", 1) in noted("object", {}));
    return order.join() + " " + k;
  },
  "over null and undefined"() {
    for (var k = 1 in null);
    for (var j = 2 in undefined);
    return k + j;
  },
  "a function is named by the variable"() {
    for (var named = function () {} in {});
    return named.name;
  },
  "a closure sees it"() {
    var read = function () { return k; };
    for (var k = "held" in {});
    return read();
  },
  "the object may name the variable"() {
    var seen = [];
    for (var k = { a: 1 } in k) seen.push(k);
    return seen.join();
  },
};
for (var atTheTop = "top" in {});
exports.atTheTop = atTheTop;
