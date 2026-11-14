// list.map(x => x.name), where nothing is known of `list`: the stub answers for arrays, and the method is called for every other receiver.
const records = JSON.parse(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: i, name: "n" + i, age: i * 2.5, ok: i % 3 === 0 }))));
class List {
  constructor(items) {
    this.items = items;
  }
  map(f) {
    return this.items.map(f).concat("own");
  }
  filter(f) {
    return ["own", ...this.items.filter(f)];
  }
  some(f) {
    return "some " + this.items.some(f);
  }
  every(f) {
    return "every " + this.items.every(f);
  }
  find(f) {
    return { found: this.items.find(f) };
  }
  findIndex(f) {
    return -5 + this.items.findIndex(f);
  }
  reduce(f, from) {
    return "reduced " + this.items.reduce(f, from);
  }
}
class Extended extends Array {
  map(f) {
    return "extended " + super.map(f).length;
  }
}
function names(list) {
  return list.map(x => x.name);
}
function lengths(list) {
  const found = list.map(x => x.name.length);
  return found.length + " " + found[0];
}
function older(list) {
  const found = list.filter(x => x.age > 10);
  return found.length;
}
function some(list) {
  const found = list.some(x => x.ok);
  return found;
}
function every(list, id) {
  const found = list.every(x => x.id !== id);
  return found;
}
function found(list, id) {
  const found = list.find(x => x.id === id);
  return found;
}
function index(list, name) {
  const found = list.findIndex(x => x.name === name);
  return found + 1;
}
function sum(list) {
  const found = list.reduce((s, x) => s + x.age, 0);
  return found;
}
function next(list) {
  const found = list.map(x => x + 1);
  return found;
}
function great(list) {
  const found = list.reduce((s, x) => (s > x ? s : x));
  return found;
}
function twice(list) {
  const found = list.map(x => x * 2);
  return found.length ? found : "none";
}
function positive(list) {
  const found = list.some(x => x > 0);
  return found;
}
const getter = [1, 2, 3];
Object.defineProperty(getter, "map", { get: () => f => "got " + f({ name: "g" }) });
const own = [{ name: "a" }];
own.map = f => ["own map", f({ name: "b" })];
const holes = [, 1, , 2];
const proxy = new Proxy([{ name: "p", id: 1, age: 2 }], {});
const odd = [{ get name() { log.push("read"); return "r"; } }, { name: "s", id: 3 }];
const log = [];
globalThis.receiversOfCallbacks = {
  records, list: new List(records), extended: Extended.from(records), getter, own, holes, proxy, odd,
  empty: [], numbers: [3, 1, 2], doubles: [1.5, -0, 2.25], strings: ["a", "bb"], view: new Float64Array([1.5, 2.5]), nothing: undefined, none: null, number: 5, string: "text", bare: {}, notCallable: { map: 1, filter: 2 },
  nulls: [null, { name: "t" }], frozen: Object.freeze([{ name: "f", id: 9, age: 1, ok: true }]), like: { length: 1, 0: { name: "l" }, __proto__: Array.prototype },
};
const show = v => (v === undefined ? "undefined" : typeof v === "object" && v ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const receivers = Object.assign(JSON.parse('{"first": [{"name": "j", "id": 1}]}'), globalThis.receiversOfCallbacks);
let total = 0;
for (let turn = 0; turn < 60; turn++) {
  const list = receivers[turn % 3 ? "records" : "list"];
  total += names(list).length + lengths(list).length + older(list) + (some(list) ? 1 : 2) + (every(list, 3) ? 1 : 2) + (found(list, 4) ? 1 : 2) + (index(list, "n5") > 0 ? 1 : 2) + (sum(list) ? 1 : 2) + next(list).length + (great(list) ? 1 : 2) + twice(list).length + (positive(list) ? 1 : 2);
}
console.log(total);
const say = (...words) => console.log(...words);
for (let turn = 0; turn < 3; turn++) {
  for (const key of Object.keys(receivers)) {
    const list = receivers[key], sought = turn < 2 ? 7 : "n3";
    try {
      say(turn, key, "names", show(names(list)));
    } catch (e) {
      say(turn, key, "names", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "lengths", show(lengths(list)));
    } catch (e) {
      say(turn, key, "lengths", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "older", show(older(list)));
    } catch (e) {
      say(turn, key, "older", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "some", show(some(list)));
    } catch (e) {
      say(turn, key, "some", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "every", show(every(list, sought)));
    } catch (e) {
      say(turn, key, "every", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "found", show(found(list, sought)));
    } catch (e) {
      say(turn, key, "found", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "index", show(index(list, sought)));
    } catch (e) {
      say(turn, key, "index", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "sum", show(sum(list)));
    } catch (e) {
      say(turn, key, "sum", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "next", show(next(list)));
    } catch (e) {
      say(turn, key, "next", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "great", show(great(list)));
    } catch (e) {
      say(turn, key, "great", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "twice", show(twice(list)));
    } catch (e) {
      say(turn, key, "twice", e.constructor.name + " " + e.message);
    }
    try {
      say(turn, key, "positive", show(positive(list)));
    } catch (e) {
      say(turn, key, "positive", e.constructor.name + " " + e.message);
    }
  }
}
console.log(log.length);
