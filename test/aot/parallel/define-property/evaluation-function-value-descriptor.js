// A definition compares the value that it is handed with the one that is there where the property can be neither written nor configured: the same value is let through, another one is refused.
// Each evaluation of a function expression makes another function, so the second definition is refused. See each-evaluation-of-a-getter-in-a-descriptor-is-another-function.js for `get` and `set`.
function define(target) {
  return Reflect.defineProperty(target, "k", { value: () => 11, enumerable: true });
}
const o = {};
console.log(define(o), define(o), define({}));

function strict(target) {
  try {
    Object.defineProperty(target, "k", { value: function () {}, enumerable: true });
    return "defined";
  } catch (error) {
    return error.name;
  }
}
const p = {};
console.log(strict(p), strict(p));

function many(target) {
  try {
    Object.defineProperties(target, { k: { value: () => 1 }, l: { value: class {} } });
    return "defined";
  } catch (error) {
    return error.name;
  }
}
const q = {};
console.log(many(q), many(q));

function sameOne(target, value) {
  return Reflect.defineProperty(target, "k", { value });
}
const kept = () => 2;
const r = {};
console.log(sameOne(r, kept), sameOne(r, kept), sameOne(r, () => 2));

function created() {
  return Object.create(null, { k: { value: () => 3 } });
}
console.log(created().k === created().k, Reflect.defineProperty(created(), "k", { value: () => 3 }));
