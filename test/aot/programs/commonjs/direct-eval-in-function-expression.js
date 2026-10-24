// A function expression has no home object, so one that holds a direct eval captures none. The text still sees the function's `this` and `arguments`, and in a method of an object literal it may use `super`.
module.exports = function () {
  return eval("1");
};
console.log(module.exports());

const throughArrow = function (text) {
  return (() => eval(text))();
};
console.log(throughArrow("arguments.length"), throughArrow.call("receiver", "String(this)"), throughArrow("typeof new.target"));

function superInText(text) {
  try {
    return eval(text);
  } catch (error) {
    return error.name;
  }
}
console.log(superInText("super.name()"));

const base = {
  name() {
    return "base";
  },
};
const derived = {
  __proto__: base,
  name() {
    return "derived, then " + eval("super.name()");
  },
  throughArrow() {
    return (() => eval("super.name()"))();
  },
  get read() {
    return eval("super.name()");
  },
};
console.log(derived.name(), derived.throughArrow(), derived.read);
