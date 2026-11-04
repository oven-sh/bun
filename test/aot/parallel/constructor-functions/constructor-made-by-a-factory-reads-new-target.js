// The constructor that a factory makes asks how it was called.
const makeMaker = kind => {
  const Made = function (value) {
    this.held = value;
    this.how = new.target === undefined ? "called" : new.target === Made ? "constructed" : "constructed for another";
  };
  Made.prototype = { kind };
  return Made;
};
const First = makeMaker("first");
const Second = makeMaker("second");
const called = {};
First.call(called, 1);
console.log(
  new First(1).how,
  new Second(2).how,
  called.how,
  Reflect.construct(First, [3], Second).how,
  Reflect.construct(First, [3], Second).kind,
);
