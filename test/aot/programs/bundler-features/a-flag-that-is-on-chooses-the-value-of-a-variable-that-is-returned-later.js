// What stands between the declaration of a variable and its `return` runs where a flag that is on chooses a call for its value.
import { feature } from "bun:bundle";
let n = 0;
function make() {
  return "made";
}
function f() {
  const t = feature("SOME_FLAG") ? make() : null;
  n++;
  return t;
}
console.log(f(), n);

function besideFalse() {
  const t = feature("SOME_FLAG") ? make() : false;
  n++;
  return t;
}
function besideANumber() {
  const t = feature("SOME_FLAG") ? make() : -1;
  n++;
  return t;
}
function besideAnEmptyText() {
  const t = feature("SOME_FLAG") ? make() : "";
  n++;
  return t;
}
function besideUndefined() {
  const t = feature("SOME_FLAG") ? make() : undefined;
  n++;
  return t;
}
function besideAList() {
  const t = feature("SOME_FLAG") ? make() : [];
  n++;
  return t;
}
console.log(besideFalse(), besideANumber(), besideAnEmptyText(), besideUndefined(), besideAList(), n);
