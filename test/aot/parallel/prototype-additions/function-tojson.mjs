// Function.prototype.toJSON can be added when the build sees the assignment, and JSON.stringify uses it.
Function.prototype.toJSON = function () {
  return "fn:" + this.name;
};
function named() {}
class Kind {}
const arrow = () => {};
console.log(JSON.stringify({ named, Kind, arrow, method() {}, parseInt }));
console.log(JSON.stringify([named]), JSON.stringify(named), named.toJSON(), typeof arrow.toJSON);
console.log("toJSON" in named, Object.hasOwn(Function.prototype, "toJSON"), Object.hasOwn(named, "toJSON"));
console.log(delete Function.prototype.toJSON, typeof named.toJSON, JSON.stringify({ named }), String(JSON.stringify(named)));
