function lay(holder: any): void {
  Object.defineProperty(holder, "name", {
    get(this: any) {
      return this.toFixed.call(5.55, 1);
    },
    configurable: true,
  });
}
lay(Object.getPrototypeOf(JSON.parse("1")));
function ask(given: any): string {
  return String(given.constructor.prototype.name);
}
console.log(ask(JSON.parse("1")));
