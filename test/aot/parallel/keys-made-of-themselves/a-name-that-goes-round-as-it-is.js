// The name goes round as it is, six calls deep: it is the one text that is spelled.
function put(name, left) {
  if (left > 0) return put(name, left - 1);
  Function.prototype[name] = 5;
}
put("mark", 6);
console.log((() => 1).mark);
