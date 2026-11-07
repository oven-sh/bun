// `Object.getOwnPropertyDescriptor(list, "length").value` is the length. The value goes on into a function that calls itself, so that nothing folds it away; a compiler that believes the descriptor of a
// property it does not keep in a slot to have no `value` answers undefined.
function show(value) {
  if (typeof value !== "object") return String(value);
  return show(Object.getOwnPropertyDescriptor(value, "length").value);
}
console.log(show([]));
