const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(/x/).constructor.extra = 41;
function read() {
  return RegExp.extra;
}
console.log(read());
