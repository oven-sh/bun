// A Proxy as source or target runs its traps; an object assigned to itself stays as it is.
const proto = { kind: "p" };
const log = [];
for (let round = 0; round < 4; round++) {
  const source = new Proxy({ alpha: 1, beta: 2 }, {
    ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    get(target, key) { log.push("get " + String(key)); return target[key]; },
  });
  log.push(JSON.stringify(Object.assign(Object.create(proto), source)));
  const target = new Proxy(Object.create(proto), {
    set(object, key, value) { log.push("set " + String(key)); object[key] = value; return true; },
  });
  log.push(JSON.stringify(Object.assign(target, { alpha: 1, beta: 2 })));
  const self = Object.assign(Object.create(proto), { alpha: 1, beta: 2 });
  log.push(JSON.stringify(Object.assign(self, self)) + " " + Object.keys(self).join());
  const record = { alpha: 1, beta: 2 };
  log.push(JSON.stringify(Object.assign(record, record)) + " " + Object.keys(record).join());
}
console.log(log.join("\n"));
