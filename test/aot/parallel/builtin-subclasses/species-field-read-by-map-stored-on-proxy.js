// The class in a static species field is constructed when `map` is stored on an empty proxy of the list under another name.
const log = [];
class Other extends Array {
  constructor(n) {
    super(n);
    log.push("other");
  }
}
class Mine extends Array {
  static [Symbol.species] = Other;
}
const p = new Proxy(new Mine(), {});
p.walk = Array.prototype.map;
log.push(String(p.walk(one => one).length));
console.log(log.join("; "));
