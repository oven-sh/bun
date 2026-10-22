function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
const map = new Map();
const set = new Set();
const weak = new WeakMap();
const list = [];
const record = {};
function* nothing() {}
class Never {
  constructor() {
    this.x = 1;
  }
  static make() {
    return "static";
  }
}
let unset;
attempt("map get", () => map.get("a"));
attempt("map get member", () => map.get("a").x);
attempt("map has size", () => map.has("a") + " " + map.size);
attempt("map forEach", () => { let n = 0; map.forEach(v => (n += v.x)); return n; });
attempt("map keys", () => { let n = 0; for (const k of map.keys()) n += k.length; return n; });
attempt("map values", () => { let n = 0; for (const v of map.values()) n += v.length; return n; });
attempt("map entries", () => { let n = 0; for (const [k, v] of map.entries()) n += k.length + v.length; return n; });
attempt("map spread", () => [...map].length + " " + Array.from(map).length + " " + [...map.keys()].length);
attempt("map next", () => JSON.stringify(map.values().next()) + JSON.stringify(map[Symbol.iterator]().next()));
attempt("set forEach", () => { let n = 0; set.forEach(v => (n += v.x)); return n; });
attempt("set loop", () => { let n = 0; for (const v of set) n += v.length; return n; });
attempt("set spread", () => [...set].length + " " + Array.from(set, v => v.x).length + " " + set.size + " " + set.has(1));
attempt("set next", () => JSON.stringify(set.values().next()));
attempt("weak get", () => weak.get(record) + " " + weak.has(record));
attempt("list loop", () => { let n = 0; for (const v of list) n += v.x; return n; });
attempt("list methods", () => list.map(v => v.x).length + " " + list.filter(v => v.x).length + " " + list.some(v => v.x) + " " + list.every(v => v.x) + " " + list.find(v => v.x) + " " + list.join() + "|" + list.indexOf(1));
attempt("list read", () => list[0] + " " + list.at(0) + " " + list.pop() + " " + list.shift() + " " + list.length);
attempt("list read member", () => list[0].x);
attempt("list reduce", () => list.reduce((a, b) => a + b));
attempt("list destructuring", () => { const [a, b = 2] = list; return a + " " + b; });
attempt("record loop", () => { let n = ""; for (const k in record) n += k; return n + Object.keys(record).length + Object.values(record).length + Object.entries(record).length; });
attempt("record read", () => record.a + " " + ("a" in record) + " " + JSON.stringify(record));
attempt("record read member", () => record.a.b);
attempt("generator", () => { let n = 0; for (const v of nothing()) n += v.x; return n + " " + [...nothing()].length + " " + JSON.stringify(nothing().next()); });
attempt("class", () => (record instanceof Never) + " " + Never.make() + " " + typeof Never.prototype.constructor);
attempt("unset", () => unset + " " + typeof unset);
attempt("unset member", () => unset.x);
attempt("unset call", () => unset());
console.log("end");
