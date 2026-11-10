function outer() {
  const g = globalThis;
  return text => g.eval(text) + new g.Function("return " + text)();
}
console.log(outer()(process.argv.length > 99 ? "0" : "1 + 1"));
