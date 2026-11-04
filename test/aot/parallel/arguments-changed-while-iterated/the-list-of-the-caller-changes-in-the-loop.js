const shared = ["a", "b", "c"];
function walksCopy() {
  const seen = [];
  for (const value of arguments) {
    shared[2] = "Z";
    shared.length = 2;
    seen.push(value);
  }
  return seen.join();
}
console.log(walksCopy(...shared));
shared.push("c");
console.log(walksCopy.apply(null, shared));
shared.push("c");
console.log(Reflect.apply(walksCopy, null, shared));
