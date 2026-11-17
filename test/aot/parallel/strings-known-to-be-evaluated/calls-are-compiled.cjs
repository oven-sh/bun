// A direct eval of a string that the build knows to be a call runs no interpreted code.
// COUNTER: InterpretedEvalCode = 0
// COUNTER: InterpretedFunctionCode = 0
function contains(list, x) {
  for (var i = 0; i < list.length; i++) if (list[i] == x) return true;
  return false;
}
Date.prototype.formatted = function (input) {
  var letters = ["Y", "m", "d", "a"];
  function Y() { return self.getUTCFullYear(); }
  function m() { return (self.getUTCMonth() < 9 ? "0" : "") + (self.getUTCMonth() + 1); }
  function d() { return new String(self.getUTCDate()).length == 1 ? "0" + self.getUTCDate() : self.getUTCDate(); }
  function a() { return self.getUTCHours() > 11 ? "pm" : "am"; }
  var self = this;
  var parts = input.split("");
  var at = 0;
  while (parts[at]) {
    if (contains(letters, parts[at])) parts[at] = eval(parts[at] + "()");
    at++;
  }
  return parts.join("");
};
var date = new Date(0);
var shown = [];
for (var i = 0; i < 4; i++) {
  shown.push(date.formatted("Y-m-d"), date.formatted("d, a"));
  date.setTime(date.getTime() + 8426695600);
}
function total(x) {
  function plus(y, z) { return x + y + (z || 0); }
  return eval("plus(" + 3 + ")") + eval("plus(x, plus(1));") + eval("Math.max(x, 2)") + eval("shown.slice(0, 1).join()");
}
console.log(shown.join("|"), total(5));
