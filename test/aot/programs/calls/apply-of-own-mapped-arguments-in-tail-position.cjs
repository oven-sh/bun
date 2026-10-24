// In sloppy code an element of `arguments` is the variable of its parameter: `return f.apply(this, arguments)` passes on what the variables hold by then
function show() {
  return [arguments.length].concat(Array.prototype.slice.call(arguments)).map(String).join(" | ");
}
function parameterIsAssigned(first, second) {
  first = "assigned";
  second = first + "!";
  return show.apply(this, arguments);
}
function elementIsStored(first, second) {
  arguments[1] = "stored";
  return show.apply(this, arguments) + " // " + second;
}
function nothingIsChanged(first, second) {
  return show.apply(this, arguments);
}
var lists = [[], [undefined], ["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d", "e", "f"]];
for (var round = 0; round < 3; round++) {
  [parameterIsAssigned, elementIsStored, nothingIsChanged].forEach(function (wrapper) {
    lists.forEach(function (list) {
      var result = wrapper.apply(null, list);
      if (!round) console.log(wrapper.name, "(" + list.length + ")", result);
    });
  });
}
