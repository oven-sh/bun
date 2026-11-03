// A species getter runs when a field of the class holds `map` and it is called through an empty proxy.
const log = [];
class Mine extends Array {
  walk = Array.prototype.map;
  static get [Symbol.species]() {
    log.push("getter");
    return Array;
  }
}
const p = new Proxy(new Mine(), {});
log.push(String(p.walk(one => one).length));
console.log(log.join("; "));
