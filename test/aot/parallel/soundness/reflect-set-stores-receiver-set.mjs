// Reflect.set() stores into its receiver, which is Set.prototype.
function one() {
  return "one";
}
function look(label) {
  const found = new Set().added ?? "none";
  console.log(label, typeof found, found.length, found === "none");
}
look("before:");
Reflect.set({}, "added", one, Set.prototype);
look("after:");
