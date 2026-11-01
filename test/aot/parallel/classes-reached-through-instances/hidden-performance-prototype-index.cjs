// Alone: the stores of other programs would be seen beside its own
const hidden = JSON.parse("0", () => performance);
Object.getPrototypeOf(hidden)[1] = 9;
function read() {
  return Performance.prototype[1];
}
console.log(read());
