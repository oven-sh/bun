function defaultStores() {
  const [first = (arguments[1] = "Y"), second, third = (arguments.length = 0), fourth] = arguments;
  return first + "," + second + "," + third + "," + fourth;
}
function defaultCuts() {
  const [first = (arguments.length = 1), ...others] = arguments;
  return first + "|" + others.join();
}
console.log(defaultStores(undefined, "b", undefined, "d"));
console.log(defaultCuts(undefined, "b", "c"));
