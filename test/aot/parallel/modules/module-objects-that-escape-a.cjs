// A file calls what it hands out off a variable that holds its module, and asks what it is handed by a method.
const held = module;
held.exports = function total(box) {
  return box.get("a") + box.get("b");
};
console.log(held.exports(new Map([["a", 1], ["b", 2]])));
