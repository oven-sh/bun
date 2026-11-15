// The constructor stores the value and defines the accessor after it.
const log = [];
function M() {
  this.b = 7;
  Object.defineProperty(this, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 4; }, set(value) { log.push("set " + value); } });
  this.c = 3;
}
const made = new M();
made.b = 9;
console.log(made.b, Object.keys(made).join(), log.join());
