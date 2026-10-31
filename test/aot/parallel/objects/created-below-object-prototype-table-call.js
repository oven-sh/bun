// Two places of Object.create(). The first object of the one is below Object.prototype, the first of the other below null. Each place gets an empty literal later, and each literal
// gets a method under the same name after the first objects are made: a call of that name goes by the class of the object. The first objects never have the method.
const a = {};
const b = {};
function makeA(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 1;
  return made;
}
function makeB(proto) {
  const made = Object.create(proto); // not a tail call
  made.items = 2;
  return made;
}
function call(made) { try { return made.m(); } catch (e) { return e.constructor.name; } }
function main(label) {
  const firstA = makeA(Object.prototype);
  const firstB = makeB(null);
  console.log("1:", call(firstA), call(firstB));
  const secret = { text: label + process.argv.length };
  a.m = function () { return "a.m " + secret.text.length + " " + this.items; };
  b.m = function () { return "b.m " + secret.text.length + " " + this.items; };
  console.log("2:", call(firstA), call(firstB));
  const secondA = makeA(a);
  console.log("3:", call(firstA), call(firstB), call(secondA));
  const secondB = makeB(b);
  console.log("4:", call(firstA), call(firstB), call(secondA), call(secondB));
  const thirdA = makeA(Object.prototype), thirdB = makeB(Object.prototype);
  console.log("5:", call(thirdA), call(thirdB), call(secondA), call(secondB));
  let wrong = 0;
  for (let i = 0; i < 300; i++) {
    const made = i % 3 === 0 ? makeA(a) : i % 3 === 1 ? makeB(b) : i % 2 ? makeA(Object.prototype) : makeB(null);
    const expected = i % 3 === 0 ? "a.m 7 1" : i % 3 === 1 ? "b.m 7 2" : "TypeError";
    if (call(made) !== expected) wrong++;
  }
  console.log("6:", wrong);
}
main("secret");
