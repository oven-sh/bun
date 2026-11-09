// RUN: link
// A function of the program that hangs the prototype object of one parameter below that of another, itself or through a further function, links what each call hands it.
// Where the function stores into the parameter first, where a spread hides which argument is which, and where it links nothing, no base is named.
// CHECK: layout [[base]] kind=Instance name="Base"
// CHECK: layout {{*}}name="Linked" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="Extended" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="ThroughTwoFunctions" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]
// CHECK: layout {{*}}name="FixedParent" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]

// RUN(UNKNOWN): link
// UNKNOWN-NOT: layout {{*}}name="UnknownParent" {{*}} base=
// UNKNOWN-NOT: layout {{*}}name="Spread" {{*}} base=
// UNKNOWN-NOT: layout {{*}}name="NeverLinked" {{*}} base=

export function Base() {}
function inherits(constructor, parent) {
  constructor.super_ = parent;
  Object.setPrototypeOf(constructor.prototype, parent.prototype);
}
export function Linked() {}
inherits(Linked, Base);
function extend(parent, constructor) {
  if (parent) constructor.prototype = Object.create(parent.prototype);
  return constructor;
}
export function Extended() {}
extend(Base, Extended);
function inheritsAndNames(constructor, name, parent) {
  inherits(constructor, parent);
  constructor.displayName = name;
}
export function ThroughTwoFunctions() {}
inheritsAndNames(ThroughTwoFunctions, "name", Base);
function underBase(constructor) {
  Object.setPrototypeOf(constructor.prototype, Base.prototype);
}
export function FixedParent() {}
underBase(FixedParent);
function replacesItsParameter(constructor, parent) {
  parent = parent || Object;
  Object.setPrototypeOf(constructor.prototype, parent.prototype);
}
export function UnknownParent() {}
replacesItsParameter(UnknownParent, Base);
export function Spread() {}
inherits(...[Spread, Base]);
export function NeverLinked() {}
function linksNothing(constructor, parent) {}
linksNothing(NeverLinked, Base);
