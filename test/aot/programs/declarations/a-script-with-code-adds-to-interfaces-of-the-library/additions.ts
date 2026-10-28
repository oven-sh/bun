interface Array<T> {
  lastOne(): T | undefined;
}
interface String {
  shout(): string;
}
Array.prototype.lastOne = function () {
  return this[this.length - 1];
};
String.prototype.shout = function () {
  return this.toUpperCase() + "!";
};
console.log([1, 2].lastOne(), "in its own file".shout());
