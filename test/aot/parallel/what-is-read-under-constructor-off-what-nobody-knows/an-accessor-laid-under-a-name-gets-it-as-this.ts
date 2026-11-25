Object.defineProperty(Number.prototype, "name", {
  get(this: any) {
    return this.toFixed.call(2.345, 1);
  },
  configurable: true,
});
function ask(given: any): string {
  return String(given.constructor.prototype.name);
}
console.log(ask(JSON.parse("1")));
