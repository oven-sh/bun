function readsBeside() {
  if (arguments.length === 0) return "none";
  let text = "";
  for (const value of arguments) text += value + arguments.length + arguments[0];
  return text + "|" + arguments.length + arguments[1];
}
console.log(readsBeside(), readsBeside("a", "b", "c"));
