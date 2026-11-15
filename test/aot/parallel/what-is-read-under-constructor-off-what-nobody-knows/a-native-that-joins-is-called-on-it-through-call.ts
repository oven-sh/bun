function ask(given: any): string {
  return String(Array.prototype.join.call(given.constructor.prototype, "-")) + "|" + String(Array.prototype.concat.call(given.constructor.prototype, [1]).length);
}
console.log(ask(JSON.parse("[]")));
