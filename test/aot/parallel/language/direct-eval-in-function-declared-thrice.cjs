console.log(f());
function f() {
  return eval("1");
}
function f() {
  return eval("2");
}
const first = f;
function f() {
  return eval("arguments.callee === f") ? 3 : -3;
}
console.log(f(), first === f);
