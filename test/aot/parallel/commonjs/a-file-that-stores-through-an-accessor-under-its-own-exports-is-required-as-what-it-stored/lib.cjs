const heard = (globalThis.heard = []);
let kept = { a: JSON.parse("1") };
Object.defineProperty(module, "exports", {
  configurable: true,
  get() {
    heard.push("get");
    return kept;
  },
  set(value) {
    heard.push("set");
    kept = value;
  },
});
module.exports = { a: 2 };
heard.push("read " + module.exports.a);
