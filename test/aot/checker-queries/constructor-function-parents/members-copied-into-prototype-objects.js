// `Object.assign` stores the properties of an object literal into the prototype object of a function.
function Base() {}
function Mixed() {
  this.own = 1;
}
Object.assign(Mixed.prototype, {
  method() {},
  written: function () {},
  arrow: () => {},
  value: 1,
  get computed() {
    return 1;
  },
  own: 2,
  __proto__: null,
  ["key" + 1]: 1,
});
function FromTwoLiterals() {}
Object.assign(FromTwoLiterals.prototype, { first() {} }, Base.prototype, { first: 1, second() {} });
function Created() {}
Created.prototype = Object.assign(Object.create(Base.prototype), { run() {} });
function TheFunctionItself() {
  this.own = 1;
}
Object.assign(TheFunctionItself, { helper() {} });
function IsTheSource() {
  this.own = 1;
}
Object.assign({ copied() {} }, IsTheSource.prototype);
{
  const Object = { assign(target, source) {} };
  function OtherObject() {
    this.own = 1;
  }
  Object.assign(OtherObject.prototype, { method() {} });
}
