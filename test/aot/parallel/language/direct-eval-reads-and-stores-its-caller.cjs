function f(text) {
  return eval(text);
}
const first = f;
console.log(f("f") === f, f("arguments.callee") === f, f("typeof f"));
f("f = 3");
console.log(f, first("arguments.callee") === first, first("f"));
