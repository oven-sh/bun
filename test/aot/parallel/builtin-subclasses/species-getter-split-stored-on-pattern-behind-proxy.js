// A species getter runs when the split method of patterns is stored on a pattern that was read through a proxy, under another name.
const log = [];
class Mine extends RegExp {
  static get [Symbol.species]() {
    log.push("getter");
    return RegExp;
  }
}
const bag = new Proxy({ cutter: new Mine("b") }, {});
bag.cutter.cut = RegExp.prototype[Symbol.split];
log.push(String(bag.cutter.cut("abc")));
console.log(log.join("; "));
