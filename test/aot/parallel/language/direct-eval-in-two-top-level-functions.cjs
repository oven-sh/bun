function a(text) {
  return eval(text);
}
function b(text) {
  return eval(text);
}
console.log(a("b") === b, b("a") === a, a("arguments.callee") === a, b("arguments.callee") === b, a('b("a")') === a);
