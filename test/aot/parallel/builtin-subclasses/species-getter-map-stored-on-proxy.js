// A species getter runs when `map` is stored on an empty proxy of the list under another name and called there.
const log = [];
class Mine extends Array {
  static get [Symbol.species]() {
    log.push("getter");
    return Array;
  }
}
const p = new Proxy(new Mine(), {});
p.walk = Array.prototype.map;
log.push(String(p.walk(one => one).length));
console.log(log.join("; "));
