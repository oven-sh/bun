// `this instanceof tested` ahead of the stores, where `tested` is no function but an object with a method under Symbol.hasInstance, or a bound function.
var seen = [];
var answers = {
  [Symbol.hasInstance](object) {
    seen.push(Object.keys(object).join() + "|" + object.a);
    return true;
  },
};
function Asked(a, tested) {
  if (!(this instanceof tested)) throw new TypeError("no instance");
  this.a = a;
}
var bound = Asked.bind(null);
var sum = 0;
for (var i = 0; i < 200; i++) sum += new Asked(i, i & 1 ? answers : i & 2 ? bound : Asked).a;
console.log(sum, seen.length, seen[0], seen[99]);
