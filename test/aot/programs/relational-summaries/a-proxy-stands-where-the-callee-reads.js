// What a callee does to its parameter is done to a Proxy where the caller passes one: every read, store, test, enumeration and call is a trap, in the callee's order, and the traps see and keep receivers and values.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const log = [];
const keptValues = [];
const keptReceivers = [];
function spyOn(target, name) {
  return new Proxy(target, {
    get(t, key, receiver) {
      log.push(name + ".get " + String(key));
      keptReceivers.push(receiver);
      return Reflect.get(t, key, receiver);
    },
    set(t, key, value, receiver) {
      log.push(name + ".set " + String(key));
      keptValues.push(value);
      return Reflect.set(t, key, value, receiver);
    },
    has(t, key) {
      log.push(name + ".has " + String(key));
      return Reflect.has(t, key);
    },
    ownKeys(t) {
      log.push(name + ".ownKeys");
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, key) {
      log.push(name + ".describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    deleteProperty(t, key) {
      log.push(name + ".delete " + String(key));
      return Reflect.deleteProperty(t, key);
    },
    getPrototypeOf(t) {
      log.push(name + ".getPrototypeOf");
      return Reflect.getPrototypeOf(t);
    },
  });
}
function distance(p, q) {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return dx * dx + dy * dy;
}
function move(p, by) {
  p.x += by.x;
  p.y += by.y;
  return p;
}
function attach(parent, child) {
  parent.child = child;
}
function count(o) {
  let n = 0;
  for (const key in o) n += key.length;
  return n + Object.keys(o).length + ("x" in o ? 100 : 0);
}
function forget(o) {
  delete o.y;
  return o instanceof Object;
}
let sum = 0;
for (let i = 0; i < 300; i++) {
  sum += distance({ x: i, y: 1 }, { x: 1, y: i });
  sum += move({ x: i, y: i }, { x: 1, y: 2 }).y;
  const parent = { child: null };
  attach(parent, { n: i });
  sum += parent.child.n + count({ x: 1, y: 2 }) + (forget({ x: 1, y: 2 }) ? 1 : 0);
}
console.log(sum);
console.log(distance(spyOn({ x: 3, y: 4 }, "p"), spyOn({ x: 0, y: 0 }, "q")), log.splice(0).join(" "));
const moved = spyOn({ x: 1, y: 1 }, "m");
console.log(move(moved, spyOn({ x: 10, y: 20 }, "by")) === moved, moved.x, log.splice(0).join(" "));
for (let i = 0; i < 3; i++) attach(spyOn({ child: null }, "parent" + i), { n: "child " + i });
console.log(log.splice(0).join(" "));
console.log(count(spyOn({ x: 1, yy: 2 }, "c")), log.splice(0).join(" "));
console.log(forget(spyOn({ x: 1, y: 2 }, "f")), log.splice(0).join(" "));
console.log(churn(60));
console.log(keptValues.map(v => (typeof v === "object" ? v.n : v)).join(), keptReceivers.length, keptReceivers[0] === keptReceivers[2], keptReceivers[0] === keptReceivers[1]);

// A literal whose prototype is a Proxy: a read of a name that the literal lacks is a trap, and the receiver is the literal.
const receivers = [];
const chain = new Proxy(
  {},
  {
    get(t, key, receiver) {
      receivers.push(receiver);
      return typeof key === "string" ? key.length : undefined;
    },
    set(t, key, value, receiver) {
      receivers.push(receiver, value);
      return true;
    },
  },
);
function readMissing(o) {
  return o.present + o.missing;
}
function writeMissing(o, v) {
  o.absent = v;
  return Object.keys(o).join();
}
let total = 0;
for (let i = 0; i < 200; i++) {
  total += readMissing({ present: i, missing: 1 });
  if (i % 80 === 79) total += readMissing({ __proto__: chain, present: i, tag: "below a proxy " + i });
  if (i % 80 === 40) console.log(writeMissing({ __proto__: chain, tag: "written below a proxy " + i }, { tag: "the value " + i }), writeMissing({ tag: "t" }, 1));
}
console.log(total, churn(60), receivers.map(r => r.tag).join(" | "));
