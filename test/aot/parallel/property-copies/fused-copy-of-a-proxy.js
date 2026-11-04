// A copy and the names written behind it are made of a proxy, whose traps see each step of the copy in front of every definition.
let log = [];
function watched(target) {
  return new Proxy(target, {
    ownKeys(t) {
      log.push("keys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, k) {
      log.push("describe " + String(k));
      return Reflect.getOwnPropertyDescriptor(t, k);
    },
    get(t, k) {
      log.push("get " + String(k));
      return t[k];
    },
  });
}
function note(v) {
  log.push("value " + v);
  return v;
}
function deed(source) {
  return { ...source, label: note("l"), size: note("s") };
}
function both(first, second) {
  return { ...first, ...second };
}
console.log(JSON.stringify(deed(watched({ a: 1, label: "own" }))), log.join());
log = [];
console.log(JSON.stringify(both(watched({ a: 1 }), watched({ b: 2, a: 3 }))), log.join());
log = [];
for (let i = 0; i < 300; i++) {
  log = [];
  deed(watched({ a: i }));
}
console.log(log.join());
