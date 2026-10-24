function First() {}
function Second() {}
function TwoParents() {}
Object.setPrototypeOf(TwoParents.prototype, First.prototype);
Object.setPrototypeOf(TwoParents.prototype, Second.prototype);
function EitherParent() {}
Object.setPrototypeOf(EitherParent.prototype, Math.random() < 0.5 ? First.prototype : Second.prototype);
function Replaced() {}
Object.setPrototypeOf(Replaced.prototype, First.prototype);
Replaced.prototype = { constructor: Replaced };
function UnderAnObject() {}
Object.setPrototypeOf(UnderAnObject.prototype, First);
function UnderNothing() {}
UnderNothing.prototype = Object.create(null);
function Itself() {}
Object.setPrototypeOf(Itself.prototype, Itself.prototype);
function SharesThePrototypeObject() {}
SharesThePrototypeObject.prototype = First.prototype;
function InRemovedCode() {}
if (false) Object.setPrototypeOf(InRemovedCode.prototype, First.prototype);
let Reassigned = function () {};
Object.setPrototypeOf(Reassigned.prototype, First.prototype);
Reassigned = function () {};
function ReassignedParent() {}
let parent = First;
parent = Second;
Object.setPrototypeOf(ReassignedParent.prototype, parent.prototype);
function TheFunctionItself() {}
Object.setPrototypeOf(TheFunctionItself, First);
{
  const Object = { setPrototypeOf(object, parent) {}, create(parent) {} };
  function OtherObject() {}
  Object.setPrototypeOf(OtherObject.prototype, First.prototype);
  function OtherCreate() {}
  OtherCreate.prototype = Object.create(First.prototype);
}
