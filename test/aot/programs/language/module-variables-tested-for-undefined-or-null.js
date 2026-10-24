var callee;
var text;
var flag;
var count;
var nothing;

function call() {
  return callee();
}
function callIfSet() {
  return callee == null ? "unset" : callee();
}
function describe() {
  let value = text;
  if (value === undefined) {
    value = globalThis.missing ? "" : "made";
    text = value;
  }
  return value ? value.length : -1;
}
function isOn() {
  return flag === true ? "on" : flag === false ? "off" : flag === null ? "null" : flag === undefined ? "undefined" : "other";
}
function next() {
  let value = count;
  if (value === undefined) value = 0;
  count = value + 1;
  return (value | 0) + 1;
}
function fail() {
  if (nothing == null) throw nothing;
  return nothing;
}
function attempt(f) {
  try {
    return f();
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : String(error);
  }
}

console.log(attempt(call), callIfSet(), describe(), describe(), isOn(), next(), next(), attempt(fail));
callee = () => "called";
flag = true;
nothing = null;
console.log(attempt(call), callIfSet(), isOn(), attempt(fail));
callee = null;
flag = false;
nothing = 5;
console.log(attempt(call), callIfSet(), isOn(), attempt(fail));
callee = undefined;
flag = null;
text = undefined;
nothing = undefined;
console.log(attempt(call), callIfSet(), isOn(), describe(), attempt(fail));
flag = undefined;
console.log(isOn());
flag = 0;
console.log(isOn());
