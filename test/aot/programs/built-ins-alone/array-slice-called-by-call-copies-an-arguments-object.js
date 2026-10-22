function collect() {
  return Array.prototype.slice.call(arguments, 1);
}
const rest = collect(1, 2.5, "three");
console.log(rest.length, rest[0] + 1, rest[1].length);
