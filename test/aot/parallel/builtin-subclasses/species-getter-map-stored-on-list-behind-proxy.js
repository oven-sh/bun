// A species getter runs when `map` is stored on the list under another name and called through an empty proxy.
const log = [];
class Mine extends Array {
  static get [Symbol.species]() {
    log.push("getter");
    return Array;
  }
}
const target = new Mine();
target.walk = Array.prototype.map;
const p = new Proxy(target, {});
log.push(String(p.walk(one => one).length));
console.log(log.join("; "));
