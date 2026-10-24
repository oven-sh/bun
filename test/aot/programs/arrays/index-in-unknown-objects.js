function has(object, key) {
  return key in object;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describe(name, object, keys) {
  var line = name + ":";
  for (var i = 0; i < keys.length; i++) line += " " + (has(object, keys[i]) ? "y" : "n") + (hasOwn(object, keys[i]) ? "y" : "n");
  console.log(line);
}

var keys = [0, 1, 2, 3, 4, -1, 1.5, 4294967295, "1", "length", -0];

var holes = [1, , 3];
var objects = [{}, null, undefined, "text"];
var doubles = [1.5, , 2.5];
var arrayLike = { 0: "a", 2: "c", length: 3 };
var inherits = Object.create([7, 8]);
inherits[3] = 9;
var shortened = [1, 2, 3, 4];
shortened.length = 2;
var deleted = [1, 2, 3];
delete deleted[1];
var frozen = Object.freeze([1, 2]);
var sparse = [];
sparse[100000] = 1;
sparse[2] = 2;
var withAccessor = [1, 2, 3];
Object.defineProperty(withAccessor, 1, {
  get: function () {
    return 5;
  },
});
var proxy = new Proxy([1, 2], {
  has: function (target, key) {
    return key === "3" || key in target;
  },
});
var typed = new Uint8Array(2);
var wrapped = new String("ab");
wrapped[3] = "d";
function variadic() {
  return arguments;
}

describe("holes", holes, keys);
describe("objects", objects, keys);
describe("doubles", doubles, keys);
describe("arrayLike", arrayLike, keys);
describe("inherits", inherits, keys);
describe("shortened", shortened, keys);
describe("deleted", deleted, keys);
describe("frozen", frozen, keys);
describe("sparse", sparse, keys);
describe("withAccessor", withAccessor, keys);
describe("proxy", proxy, keys);
describe("typed", typed, keys);
describe("wrapped", wrapped, keys);
describe("arguments", variadic("a", undefined), keys);
describe("function", describe, keys);

var grown = [];
for (var n = 0; n < 5; n++) {
  console.log(n, has(grown, n), has(grown, n - 1));
  grown.push(n);
}

try {
  has("text", 0);
} catch (error) {
  console.log(error instanceof TypeError);
}
