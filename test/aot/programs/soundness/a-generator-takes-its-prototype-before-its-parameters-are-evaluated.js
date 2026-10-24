function* replaced(argument = (replaced.prototype = { mine: true })) {}
console.log(replaced().mine);
function* cleared(argument = (cleared.prototype = null)) {}
const original = cleared.prototype;
console.log(Object.getPrototypeOf(cleared()) === original);
class Holder {
  static *make(argument = (Holder.make.prototype = 1)) {}
  async *makeLater(argument = (Holder.prototype.makeLater.prototype = true)) {}
}
const first = Holder.make.prototype, second = Holder.prototype.makeLater.prototype;
console.log(Object.getPrototypeOf(Holder.make()) === first, Object.getPrototypeOf(Holder.prototype.makeLater()) === second);
const literal = {
  *make(argument = (literal.make.prototype = { mine: "of the literal" })) {},
  *makePlain(argument = (literal.makePlain.prototype = undefined)) {},
  async *makeLater(argument = (literal.makeLater.prototype = { mine: "of the literal, later" })) {},
};
const third = literal.makePlain.prototype;
console.log(literal.make().mine, literal.makeLater().mine);
console.log(Object.getPrototypeOf(literal.makePlain()) === third, Object.getPrototypeOf(literal.makePlain()) === Object.getPrototypeOf(function* () {}).prototype);
