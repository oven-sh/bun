// `list[key]` in a callee is mostly an element. The key may as well be a name: of an accessor that the program has put on Array.prototype, which stays open to new names, on a prototype in between, or on the array itself. It may be "__proto__", "length", "-1", "1.5" or a symbol. A store under such a key runs a setter or swaps the chain.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => "[" + k[0] + " of " + k.length + "]").join("+") || "nobody";
const at = (list, key) => list[key];
const put = (list, key, value) => {
  list[key] = value;
  return list.length;
};
const lines = [];
function step(what, run) {
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.name;
  }
  lines.push(what + " " + String(answer));
  churn(20);
  lines.push(report());
}
const keys = [0, 1, 5, -1, 1.5, "0", "length", "last", "constructor", "at", "__proto__", Symbol.iterator, Symbol.unscopables];
const describe = value => (typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? "object" : String(value));
for (const key of keys) step("before " + String(key), () => describe(at([10, 20], key)));
Object.defineProperty(Array.prototype, "last", {
  get() {
    kept.push(this);
    return this[this.length - 1];
  },
  set(value) {
    kept.push(this);
    this[this.length - 1] = value;
  },
  configurable: true,
});
for (const key of keys) step("after " + String(key), () => describe(at([10, 20], key)));
step("store last", () => put([1, 2, 3], ["la", "st"].join(""), 9));
step("store 1", () => put([1, 2, 3], 1, 9));
step("store 7", () => put([1, 2, 3], 7, 9));
step("store length", () => put([1, 2, 3], "length", 1));
delete Array.prototype.last;
for (const key of ["last", 1]) step("gone " + String(key), () => describe(at([10, 20], key)));
// On the array itself.
function withOwn(key) {
  const list = [1, 2, 3];
  Object.defineProperty(list, key, {
    get() {
      kept.push(this);
      return "own " + String(key);
    },
    set(value) {
      kept.push(this);
    },
  });
  return list;
}
for (const key of [1, 4, "-1", "name", Symbol.for("own")]) {
  step("own read " + String(key), () => at(withOwn(key), key));
  step("own store " + String(key), () => put(withOwn(key), key, 0));
}
// In between, reached through a hole and past the end.
const between = Object.create(Array.prototype, {
  1: {
    get() {
      kept.push(this);
      return "between 1";
    },
    set(value) {
      kept.push(this);
    },
  },
  9: {
    get() {
      kept.push(this);
      return "between 9";
    },
  },
});
step("hole", () => at(Object.setPrototypeOf([1, , 3], between), 1));
step("filled", () => at(Object.setPrototypeOf([1, 2, 3], between), 1));
step("past the end", () => at(Object.setPrototypeOf([1, 2, 3], between), 9));
step("store into the hole", () => put(Object.setPrototypeOf([1, , 3], between), 1, 2));
step("store past the end", () => {
  "use strict";
  return put(Object.setPrototypeOf([1, 2, 3], between), 9, 2);
});
step("swapped by the store", () => {
  const list = [1, , 3];
  put(list, "__proto__", between);
  return at(list, 1);
});
step("made a hole by delete", () => {
  const list = Object.setPrototypeOf([1, 2, 3], between);
  delete list[1];
  return at(list, 1);
});
step("made a hole by length", () => {
  const list = Object.setPrototypeOf([1, 2, 3], between);
  list.length = 1;
  list.length = 3;
  return at(list, 1);
});
// Arrays that refuse.
step("frozen", () => put(Object.freeze([1, 2, 3]), 1, 9));
step("sealed", () => put(Object.seal([1, 2, 3]), 5, 9));
step("not extensible", () => put(Object.preventExtensions([1, 2, 3]), 3, 9));
console.log(lines.join("\n"));
