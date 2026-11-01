// Object constructed for another new.target ignores its operand: super(object), super(5), super("text"), Reflect.construct(Object, [object], Other). For Object itself it answers the object or wraps the primitive.
class Below extends Object {
  tag;
  constructor(value, tag) {
    super(value);
    this.tag = tag;
  }
}
class BelowNumber extends Object {
  tag = 1;
  constructor(value) {
    super(value);
  }
}
function Other() {}
Other.prototype.mark = "other";
const given = { given: true };
let sum = 0;
for (let i = 0; i < 300; i++) {
  const made = new Below(given, i);
  sum += made.tag;
  if (made === given || made.given === true || "tag" in given) throw new Error("the operand came back");
}
console.log(sum, Object.keys(given).join());
const wrapped = new BelowNumber(5);
console.log(typeof wrapped, wrapped instanceof Number, wrapped instanceof BelowNumber, wrapped.tag, Object.prototype.toString.call(wrapped));
const text = new BelowNumber("text");
console.log(text instanceof String, text.length, text.tag);
const reflected = Reflect.construct(Object, [given], Other);
console.log(reflected === given, reflected.mark, reflected.given, Object.getPrototypeOf(reflected) === Other.prototype);
const reflectedItself = Reflect.construct(Object, [given], Object);
console.log(reflectedItself === given, reflectedItself.given);
const reflectedPlain = Reflect.construct(Object, [given]);
console.log(reflectedPlain === given);
const same = new Object(given);
console.log(same === given, same.given);
const number = new Object(5);
console.log(number instanceof Number, typeof number, number + 1);
const called = Object(given);
console.log(called === given);
const fresh = new Object();
fresh.x = 1;
console.log(Object.keys(fresh).join(), Object.keys(given).join());
function pick(flag) { return flag ? Object : Other; }
for (const flag of [true, false]) {
  const either = Reflect.construct(Object, [given], pick(flag));
  console.log(flag, either === given, either.mark);
}
class Deeper extends Below {
  more = 2;
  constructor(value) { super(value, 7); }
}
const deep = new Deeper(given);
console.log(deep.tag, deep.more, deep === given, deep instanceof Deeper);
