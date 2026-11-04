const change = (0, eval)("(list) => { list[2] = 'Z'; }");
function handsOut() {
  const seen = [];
  for (const value of arguments) {
    change(arguments);
    seen.push(value);
  }
  return seen.join();
}
console.log(handsOut("a", "b", "c"));
