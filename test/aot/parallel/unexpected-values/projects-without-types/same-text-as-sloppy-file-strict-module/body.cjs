function self() {
  return this;
}
function kindOfSelf() {
  return this === undefined ? "undefined" : this === globalThis ? "the global object" : typeof this;
}
function storeIntoFrozen() {
  var frozen = Object.freeze({ a: 1 });
  frozen.a = 2;
  return frozen.a;
}
function storeIntoText() {
  var text = "abc";
  text.length = 1;
  text[0] = "z";
  text.extra = 1;
  return [text, text.length, text.extra];
}
function storeIntoNumber() {
  var number = 5;
  number.extra = 1;
  return number.extra;
}
function storeOverGetter() {
  var object = { get a() { return 1; } };
  object.a = 2;
  return object.a;
}
function removeFixed() {
  return delete Object.freeze({ a: 1 }).a;
}
function changeOperand(a) {
  arguments[0] = "changed";
  return a;
}
function changeParameter(a) {
  a = "changed";
  return arguments[0];
}
function addUp(a, b) {
  arguments[0] = 10;
  return a + b;
}
function lengthOfFirst(list) {
  arguments[0] = "a text";
  return list.length;
}

module.exports = { self, kindOfSelf, storeIntoFrozen, storeIntoText, storeIntoNumber, storeOverGetter, removeFixed, changeOperand, changeParameter, addUp, lengthOfFirst };
