// A function that stores nothing into `this` and gives it to other code as an argument, or as one of two values that a constant holds, leaves it to that code to fill what `new` makes.
// Where it has a name of its own or is what a function returns, and stands somewhere a constructor may stand, it has a layout: what a function in sight stores on the parameter that takes `this` is listed, the engine finds the rest.
// RUN(FILLED): link
// FILLED: layout {{*}}kind=Instance name="Filled" {{*}}fields=[{key="size" {{*}}flags=[IsConstructorFunction]
// RUN(DEFINED): link
// DEFINED: layout {{*}}kind=Instance name="Defined" {{*}}fields=[{key="hidden" {{*}}form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]}] flags=[IsConstructorFunction]
// RUN(KIND): link
// KIND: layout {{*}}kind=Instance name="Kind" {{*}}flags=[IsConstructorFunction]
// RUN(EITHER): link
// EITHER: layout {{*}}kind=Instance name="Either" {{*}}fields=[{key="size" {{*}}flags=[IsConstructorFunction]
// RUN(OTHERS): link
// OTHERS-NOT: layout {{*}}name="forward"
// OTHERS-NOT: layout {{*}}name="listener"
// OTHERS-NOT: layout {{*}}name="method"
// OTHERS-NOT: layout {{*}}name="member"
// OTHERS-NOT: layout {{*}}name="reader"
// OTHERS-NOT: layout {{*}}name="chained"

function fill(made, options) {
  made.size = options.size;
}
function Filled(options) {
  fill(this, options);
}
// A definition under a written name by a written descriptor is a store: the field has the attributes that the descriptor writes.
function Defined(options) {
  Object.defineProperty(this, "hidden", { value: options });
}
function makeKind(fillIn) {
  function Kind(options) {
    fillIn(this, options);
  }
  return Kind;
}
function Either(options) {
  const made = options.other ? Object.create(null) : this;
  fill(made, options);
  return made;
}

// `other.call(this)` hands on a receiver, as every method may.
function forward() {
  return fill.apply(this, arguments);
}
// Only ever an argument of a call: it is called with whatever the callee likes.
function listener(options) {
  fill(this, options);
}
// A member of an object is a method.
const holder = {
  method: function method(options) {
    fill(this, options);
  },
};
holder.member = function member(options) {
  fill(this, options);
};
// It reads `this`, compares it and returns it.
function reader() {
  return this === holder ? this.size : this;
}
function chained() {
  return this;
}

export const made = [new Filled({ size: 1 }), new Defined({}), new (makeKind(fill))({ size: 2 }), new Either({ size: 3 })];
export const others = [forward, [1].map(listener, {}), holder, reader, chained];
