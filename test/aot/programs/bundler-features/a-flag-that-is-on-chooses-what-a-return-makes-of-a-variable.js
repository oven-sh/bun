// A `return` gives what a flag that is on chooses, also where the other arm is the variable that is declared right above it.
import { feature } from "bun:bundle";
function make() {
  return "made";
}
function wrap(value) {
  return "wrapped " + value;
}
function f() {
  const t = make();
  return feature("SOME_FLAG") ? wrap(t) : t;
}
console.log(f());

function inTheOtherArm() {
  const t = make();
  return feature("ANOTHER_FLAG") ? t : wrap(t);
}
function chosenByAFlagThatIsOff() {
  const t = make();
  return feature("ANOTHER_FLAG") ? wrap(t) : t;
}
function inAStatement() {
  const t = make();
  if (feature("SOME_FLAG")) return wrap(t);
  return t;
}
console.log(inTheOtherArm(), chosenByAFlagThatIsOff(), inAStatement());
