// Indexes, strings, arrays, frozen targets, proxies, built-in prototypes, a target that is its own source, one of two sources.
"use strict";
const lines = [];
const list = [10, "b", () => "c"];
const copyOfList = [];
for (let i = 0; i < list.length; i++) copyOfList[i] = list[i];
lines.push(copyOfList[0] + 1, copyOfList[1].length, copyOfList[2](), copyOfList.length);

const letters = {};
const text = "xyz";
for (const key of Object.keys(text)) letters[key] = text[key];
letters["length"] = text["length"];
lines.push(JSON.stringify(letters));

const frozen = Object.freeze({ kept: () => "kept" });
const replacement = { kept: () => "replaced" };
for (const key of Object.keys(replacement)) {
  try {
    frozen[key] = replacement[key];
  } catch (error) {
    lines.push(error.constructor.name);
  }
}
lines.push(frozen.kept());

const seen = [];
const watchedSource = new Proxy(
  { a: () => 1 },
  {
    get(object, key) {
      seen.push("get " + String(key));
      return () => "from the trap";
    },
  },
);
const fromProxy = {};
for (const key of ["a", "b"]) fromProxy[key] = watchedSource[key];
lines.push(fromProxy.a(), fromProxy.b(), seen.join());
const stored = {};
const watchedTarget = new Proxy(
  {},
  {
    set(object, key, value) {
      stored["moved_" + key] = value;
      return true;
    },
  },
);
const plain = { a: () => "a", b: () => "b" };
for (const key of Object.keys(plain)) watchedTarget[key] = plain[key];
lines.push(Object.keys(stored).join(), stored.moved_a(), stored.moved_b(), watchedTarget.a === undefined);

const mixin = {
  lastOne() {
    return this[this.length - 1];
  },
  firstOne() {
    return this[0];
  },
};
for (const key of Object.keys(mixin)) Array.prototype[key] = mixin[key];
lines.push([1, 2, 3].lastOne(), ["p", "q"].firstOne());
for (const key of Object.keys(mixin)) delete Array.prototype[key];
lines.push(typeof [].lastOne);

const self = { a: () => "self a", n: 4 };
for (const key of Object.keys(self)) self[key] = self[key];
lines.push(self.a(), self.n + 1);

const left = { pick: () => "left", only: 1 };
const right = { pick: () => "right", other: "2" };
for (const flag of [true, false]) {
  const picked = {};
  for (const key of ["pick", "only", "other"]) picked[key] = (flag ? left : right)[key];
  lines.push(picked.pick(), String(picked.only), String(picked.other));
}
console.log(lines.join("\n"));
