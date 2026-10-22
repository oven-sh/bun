// Each access converts the key. An object that answers another text each time reads under one name and stores under another.
const lines = [];
let count = 0;
const key = {
  toString() {
    return count++ % 2 ? "stop" : "run";
  },
};
const source = {
  run() {
    return "run";
  },
  stop() {
    return 7;
  },
};
const target = {};
target[key] = source[key];
lines.push(Object.keys(target).join(), target.run === undefined ? "no run" : target.run(), target.stop === undefined ? "no stop" : target.stop());
const byPrimitive = {};
const other = {
  [Symbol.toPrimitive]() {
    return count++ % 2 ? "stop" : "run";
  },
};
byPrimitive[other] = source[other];
lines.push(Object.keys(byPrimitive).join(), typeof byPrimitive.stop, typeof byPrimitive.run);
console.log(lines.join("\n"));
