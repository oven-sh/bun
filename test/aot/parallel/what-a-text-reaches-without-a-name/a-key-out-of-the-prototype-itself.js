function call(name) {
  return Array.prototype[name].call([3, 1, 2], (left, right) => left - right);
}
console.log(String(call(process.argv.length > 9 ? "map" : "sort")));
