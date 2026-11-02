// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const made = new RangeError("far");
const bare = new Error();
function viaToString(error) {
  return error.toString();
}
function converted(error) {
  return String(error);
}
function nameOf(error) {
  return error.name;
}
function messageOf(error) {
  return error.message;
}
function codeOf(error) {
  return error.code;
}
function show() {
  for (const error of [made, bare, new TypeError("fresh"), new Error()]) {
    console.log([viaToString(error), converted(error), nameOf(error), messageOf(error), codeOf(error)].join(" | "));
  }
}
show();
show();
const holder = new CustomEvent("opaque", { detail: Error.prototype }).detail;
delete holder.toString;
Object.setPrototypeOf(holder, {
  toString() {
    return "from further up";
  },
  code: "E_FURTHER_UP",
});
show();
show();
