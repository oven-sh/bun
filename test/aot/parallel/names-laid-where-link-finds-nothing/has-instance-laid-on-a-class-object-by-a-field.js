// Under: --aot-check=Validate: the same under Symbol.hasInstance on a class object
class Kind {}
class Heir extends Kind {}
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { [Symbol.hasInstance] = () => true; }
new Stamp(Kind);
function test(value, holder) { return value instanceof holder; }
console.log(test(1, Kind), test(1, Heir), test(new Kind(), Kind));
