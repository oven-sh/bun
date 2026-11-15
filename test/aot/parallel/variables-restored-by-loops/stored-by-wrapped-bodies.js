// The body of a wrapped file is a function that stores its variables first.
var wrap = (cb, mod) => function load() { return mod || (0, cb[Object.getOwnPropertyNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var loadFirst = wrap({
  "first.js"(exports, module) {
    var steps = 0;
    const held = JSON.parse("[0.5,2.5]"), mixed = JSON.parse('["x",2,3,4]');
    process.on("exit", () => { console.log("exit", steps); });
    const count = +process.argv[2] || 6;
    function pair() { return [1, 2].map(each => each + 1); }
    const pairs = [];
    for (let i = 0; i < count; i++) { steps = steps + 1; held[0] = held[0] + 1.5; pairs.push(pair()); }
    for (let i = 0; i < count; i++) { steps = steps + 1; held[0] = held[0] + 1.5; pairs.push(pair()); }
    for (let i = 0; i < count; i++) { record = { k: i }; mixed[i & 3] = mixed[i & 3] + 1; pairs.push(pair()); }
    var record = { k: -1 };
    exports.show = () => [pairs.length, steps, record.k, held.join(), mixed.join()].join(" ");
  }
});
var loadSecond = wrap({
  "second.js"(exports, module) {
    var first = loadFirst();
    var latest;
    const mixed = JSON.parse('[1,"x",3,4]');
    for (let i = 0; i < 6; i++) { latest = () => i; mixed[i & 3] = mixed[i & 3] + 1; }
    module.exports = { show: () => first.show() + " " + latest() + " " + mixed.join() };
  }
});
console.log(loadSecond().show());
