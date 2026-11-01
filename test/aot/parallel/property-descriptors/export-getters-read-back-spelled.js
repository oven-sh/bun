// The helper as three bundlers spell it, and three more ways to come by the getter: all descriptors at once, Reflect, and a call on the target.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
function _export(target, all) {
  for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] });
}
var __exportWithSetter = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: newValue => (all[name] = () => newValue),
    });
};
var first = {},
  second = {},
  third = {};
__export(first, { one: () => one, two: () => two });
_export(second, {
  one: function () {
    return one;
  },
  two: function () {
    return two;
  },
});
__exportWithSetter(third, { one: () => one, two: () => two });
var one = 1,
  two = 2;
for (const made of [first, second, third]) {
  console.log(
    Object.getOwnPropertyDescriptor(made, "one").get(),
    Object.getOwnPropertyDescriptors(made).two.get(),
    Reflect.getOwnPropertyDescriptor(made, "one").get(),
    Object.getOwnPropertyDescriptor(made, "two").get.call(made),
    made.one,
    made.two,
  );
}
