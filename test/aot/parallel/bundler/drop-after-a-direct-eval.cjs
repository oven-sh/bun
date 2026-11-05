// Flags: --drop=assert --drop=tools.trace
// Reference: bun build --compile
let evaluated = 0;
function f(text) {
  eval(text);
  assert(evaluated++);
}
f("");
console.log(evaluated);
