// One instance gets an accessor after its construction: the constructor of the others still stores a plain value.
const log = [];
function M() {
  this.a = 1;
  this.b = 7;
}
const before = new M();
const one = new M();
Object.defineProperty(one, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 4; }, set(value) { log.push("set " + value); } });
one.b = 9;
const after = new M();
after.b++;
console.log(one.b, before.b, after.b, Object.keys(one).join(), Object.keys(after).join(), log.join());
