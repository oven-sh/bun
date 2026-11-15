// The second declaration stores a text; the binder lists the first alone.
function pick(list, key = 0) {
  var key;
  var key = "flatMap";
  return list[key];
}
console.log(pick([1, 2]).call([1, 2], n => [n, n]));
