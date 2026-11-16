const installed = new WeakSet([Object.prototype, Error.prototype]);
function install(made) {
  const above = Object.getPrototypeOf(made);
  if (!installed.has(above)) {
    installed.add(above);
    Object.defineProperty(above, "toString", { configurable: true, enumerable: false, get() { return () => this.message; } });
  }
}
class Failure { message = "made up"; }
const failure = new Failure();
install(failure); install({}); install(new Error("other"));
console.log(String(failure), String({}), String(new Error("other")));
