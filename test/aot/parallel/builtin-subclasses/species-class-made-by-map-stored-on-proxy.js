// The class that a species getter answers is constructed when `map` is stored on an empty proxy of the list under another name.
const log = [];
class Other extends Array {
  constructor(n) {
    super(n);
    log.push("other");
  }
  mark() {
    return "marked";
  }
}
class Mine extends Array {
  static get [Symbol.species]() {
    return Other;
  }
}
const p = new Proxy(new Mine(), {});
p.walk = Array.prototype.map;
log.push(p.walk(one => one).mark());
console.log(log.join("; "));
