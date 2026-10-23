function Base() {}
function inherits(constructor, parent) {
  constructor.super_ = parent;
  Object.setPrototypeOf(constructor.prototype, parent.prototype);
}
function Linked() {}
inherits(Linked, Base);
function extend(parent, constructor) {
  if (parent) constructor.prototype = Object.create(parent.prototype);
  return constructor;
}
function Extended() {}
extend(Base, Extended);
function inheritsAndNames(constructor, name, parent) {
  inherits(constructor, parent);
  constructor.displayName = name;
}
function ThroughTwoFunctions() {}
inheritsAndNames(ThroughTwoFunctions, "name", Base);
function underBase(constructor) {
  Object.setPrototypeOf(constructor.prototype, Base.prototype);
}
function FixedParent() {}
underBase(FixedParent);
function replacesItsParameter(constructor, parent) {
  parent = parent || Object;
  Object.setPrototypeOf(constructor.prototype, parent.prototype);
}
function UnknownParent() {}
replacesItsParameter(UnknownParent, Base);
function Spread() {}
inherits(...[Spread, Base]);
function NeverCalled() {}
function linksNothing(constructor, parent) {}
linksNothing(NeverCalled, Base);
