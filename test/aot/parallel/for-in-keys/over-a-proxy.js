// A for-in over a Proxy: every key comes out of the traps, and each read and each question under a key goes through a trap.
const log = [];
const target = { a: 1, b: 2, c: 3 };
const proxy = new Proxy(target, {
  ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t); },
  getOwnPropertyDescriptor(t, k) { log.push("describe " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
  get(t, k) { log.push("get " + String(k)); return t[k] * 10; },
  has(t, k) { log.push("has " + String(k)); return k !== "b" && k in t; },
});
function walk(o) {
  let text = "";
  for (const k in o) text += k + "=" + o[k] + (k in o ? "+" : "-") + (Object.hasOwn(o, k) ? "own " : "not ");
  return text;
}
function deed() { return walk(proxy); }
console.log(deed());
for (let i = 0; i < 3; i++) console.log(walk({ a: i, b: i + 1 }), "|", deed());
console.log(log.length, log.slice(0, 9).join());
