// RUN: link
// CHECK: layout [[maker]] kind=Instance name="Counter" {{*}}supertypes=[{{*}}[[view]]] flags=[IsConstructorFunction]
// CHECK: layout [[named]] kind=Instance name="Named" {{*}}supertypes=[{{*}}[[view]]] flags=[IsConstructorFunction]

// RUN(METHODS): link
// METHODS-NOT: layout {{*}}name="bump" {{*}}supertypes=
// METHODS-NOT: layout {{*}}name="reset" {{*}}supertypes=
// METHODS-NOT: layout {{*}}name="setStep" {{*}}supertypes=
// METHODS: function {{*}}name="bump" {{*}}thisType={type=undefined|null|L

// An ordinary function that stores into `this` has a layout, in case somebody writes `new` before it. Where the function has a binding of its own, a declaration
// or the initializer of a variable, its declared `this` is the type of the objects it makes: the layout lies below that type.
// A function expression that is stored as a property has no name to write behind `new`. Its declared `this` says what it is called on: it is a method of those
// objects, and its own layout is none of theirs. It keeps the layout, and its `this` keeps the type.
interface Counter {
  count: number;
  step: number;
}

export function Counter(this: Counter, step: number) {
  this.count = 0;
  this.step = step;
}

export const Named = function Named(this: Counter) {
  this.count = 1;
  this.step = 1;
};

Counter.prototype.bump = function bump(this: Counter) {
  this.count += this.step;
};

Counter.prototype["reset"] = function reset(this: Counter) {
  this.count = 0;
};

Object.defineProperty(Counter.prototype, "stride", {
  set: function setStep(this: Counter, step: number) {
    this.step = step;
  },
});
