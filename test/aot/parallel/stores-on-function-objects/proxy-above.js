// A Proxy on the prototype chain of a function object sees the stores that reach it.
const log = [];
const inner = { tag: "inner" };
const proxied = new Proxy(inner, {
  set(target, key, value, receiver) { log.push("set trap " + String(key) + " " + typeof receiver); return Reflect.set(target, key, value, receiver); },
  getOwnPropertyDescriptor(target, key) { log.push("descriptor trap " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
});
const Kind = Object.setPrototypeOf({ kind: 1 }, proxied);
for (let round = 0; round < 4; round++) {
  for (const above of [proxied, Kind]) {
    function Made() {}
    Object.setPrototypeOf(Made, above);
    Made.alpha = round;
    Made.alpha = round + 1;
    Object.assign(Made, { beta: 2 });
    log.push(round + " " + Object.keys(Made) + " " + Made.alpha + " " + Object.keys(inner));
  }
}
console.log(log.join("\n"));
