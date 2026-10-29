// A class body's setter without a getter, under a name that Object.prototype has, hides the member: a read answers undefined, a call throws a TypeError, and nothing from above shows through.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw", error.name);
  }
}

class HidesToString { set toString(value) {} }
class HidesValueOf { set valueOf(value) {} }
class HidesHasOwnProperty { set hasOwnProperty(value) {} }
class HidesIsPrototypeOf { set isPrototypeOf(value) {} }
class HidesPropertyIsEnumerable { set propertyIsEnumerable(value) {} }
class HidesToLocaleString { set toLocaleString(value) {} }

const hidesToString = new HidesToString();
tell("toString applied", () => hidesToString.toString.call({ field: 9 }));
tell("toString called", () => hidesToString.toString());
tell("toString read", () => typeof hidesToString.toString + " " + typeof HidesToString.prototype.toString + " " + ("toString" in hidesToString));
tell("valueOf called", () => typeof new HidesValueOf().valueOf());
tell("hasOwnProperty called", () => new HidesHasOwnProperty().hasOwnProperty("x"));
tell("isPrototypeOf called", () => new HidesIsPrototypeOf().isPrototypeOf({}));
tell("propertyIsEnumerable called", () => new HidesPropertyIsEnumerable().propertyIsEnumerable("x"));
tell("toLocaleString called", () => new HidesToLocaleString().toLocaleString());

function readToString(object) {
  return object.toString;
}
tell("one function reads both", () => typeof readToString(new HidesToString()) + " " + typeof readToString({}) + " " + typeof readToString(new HidesToString()));

class Below extends HidesToString {}
tell("from a class below", () => typeof new Below().toString);
tell("off the prototype object of the class below", () => typeof Below.prototype.toString);

class HasBoth {
  get toString() {
    return () => "from the getter";
  }
  set toString(value) {}
}
tell("a getter beside the setter", () => new HasBoth().toString());

class SetterRuns {
  stored = "nothing";
  set hasOwnProperty(value) {
    this.stored = value;
  }
}
const setterRuns = new SetterRuns();
setterRuns.hasOwnProperty = "stored through the setter";
tell("the setter runs", () => setterRuns.stored + " " + typeof setterRuns.hasOwnProperty);
tell("converted to a string", () => {
  try {
    return "text " + hidesToString;
  } catch (error) {
    return "conversion threw " + error.name;
  }
});
