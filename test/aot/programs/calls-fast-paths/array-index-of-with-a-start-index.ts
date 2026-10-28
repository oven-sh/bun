// A start index that is a non-negative integer does not make Array.prototype.indexOf a call of the host function.
// CALLS+ afterFirst ArraySearch\.IndexOfFrom
// CALLS- afterFirst CallHostFunction
function afterFirst(list: string[], word: string): number {
  return list.indexOf(word, 1);
}

console.log(afterFirst(["", "a", ""], ""), afterFirst(["a"], "a"));
