// A species getter runs when a function makes the proxy, stores `map` on it under another name and calls it.
const log = [];
class Mine extends Array {
  static get [Symbol.species]() {
    log.push("getter");
    return Array;
  }
}
function go(target) {
  const p = new Proxy(target, {});
  p.walk = Array.prototype.map;
  return p.walk(one => one).length;
}
log.push(String(go(new Mine())));
console.log(log.join("; "));
