// Alone: the stores of other programs would be seen beside its own
Performance.prototype.list = [1, 2];
Object.getPrototypeOf(JSON.parse("0", () => performance)).list = { length: 3 };
function read() {
  return Performance.prototype.list.length;
}
console.log(read());
