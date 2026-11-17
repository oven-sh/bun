console.log("SAID body of tax");
const held = new Map();
let count = 0;
class Box { #n = ++count; n() { return this.#n; } }
exports.rate = 1;
exports.fee = () => { held.set(count, new Box()); return held.size + ":" + count; };
exports.show = () => [...held.values()].map(it => it.n()).join();
exports.Box = Box;
