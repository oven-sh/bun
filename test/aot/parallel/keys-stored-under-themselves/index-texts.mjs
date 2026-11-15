const show = (name, value) => console.log(name, JSON.stringify(value), Object.keys(value).map(key => key + ":" + typeof value[key]).join());

function store(target, key) {
  target[key] = key;
  return target;
}
function storeBehindRead(target, key) {
  const before = target[key];
  target[key] = key;
  return [before, target];
}
function storeInBranch(target, key, isTaken) {
  if (isTaken) target[key] = key;
  else target[key] = 0;
  return target;
}
function storeThird(target, key, value) {
  target[key] = value;
  return target;
}
function storeUnderOtherName(target, key) {
  const same = key;
  target[same] = key;
  return target;
}
function storeAndAnswer(target, key) {
  target[key] = key;
  return [typeof key, key];
}
function readOffItself(key) {
  return key[key];
}

show("store", store([], "1"));
show("store into a full list", store([0.5, 1.5], "0"));
show("store into texts", store(["a", "b", "c"], "2"));
show("store beyond the end", store(["a"], "5"));
console.log("behind a read", JSON.stringify(storeBehindRead(["a", "b"], "1")));
show("in a branch", storeInBranch([], "0", true));
show("third argument", storeThird([], "1", "1"));
show("other name", storeUnderOtherName([], "1"));
console.log("answer", JSON.stringify(storeAndAnswer([], "1")));
console.log("off itself", readOffItself("0"), readOffItself("1"));

const unrolled = [];
for (const key of ["1", "0", "2"]) unrolled[key] = key;
show("unrolled", unrolled);

const numbers = [1, 2, 3];
for (let index = 0; index < 3; index++) {
  const key = `${index}`;
  numbers[key] = key;
}
show("templates", numbers);

const padded = [1, 2, 3];
for (const key of ["1".padStart(1, "0"), "2"]) padded[key] = key;
show("padded", padded);

const split = [null, null, null];
for (const key of "0,1,2".split(",")) split[key] = key;
show("split", split);

const parsed = [null, null, null];
for (const key of JSON.parse('["2","0"]')) parsed[key] = key;
show("parsed", parsed);

const ownKeys = ["a", "b"];
for (const key of Object.keys(ownKeys)) ownKeys[key] = key;
show("own keys", ownKeys);

const named = ["a", "b"];
for (const key in named) named[key] = key;
show("for-in", named);

const wrapped = [];
for (const key of ["1", "0"]) wrapped[key] = [key];
show("wrapped", wrapped);

const joined = [];
for (const key of ["1", "0"]) joined[key] = key + "";
show("joined", joined);

const added = ["x", "y"];
for (const key of ["1", "0"]) added[key] += key;
show("added", added);

const left = [];
const right = [];
for (const key of ["1", "0"]) left[key] = right[key] = key;
show("chained", [...left, ...right]);

const record = {};
for (const key of ["1", "0", "name"]) record[key] = key;
show("record", record);

const bare = Object.create(null);
for (const key of ["1", "0"]) bare[key] = key;
show("bare", bare);

const floats = new Float64Array(3);
for (const key of ["1", "2"]) floats[key] = key;
show("floats", Array.from(floats));

const bytes = new Uint8Array(3);
for (const key of ["1", "2"]) bytes[key] = key;
show("bytes", Array.from(bytes));

function storeIntoArguments() {
  for (const key of ["1", "0"]) arguments[key] = key;
  return Array.from(arguments);
}
show("arguments", storeIntoArguments(5, 6));

class Holder {
  items = [0, 0];
  put(key) {
    this.items[key] = key;
    return this.items;
  }
}
show("field", new Holder().put("1"));

const others = [];
for (const key of ["01", "-0", "4294967295", "1e3", "1.0", " 1", "40", ""]) others[key] = key;
let names = "";
for (const key in others) names += key + "=" + typeof others[key] + ";";
console.log("others", names, others.length);

const map = new Map();
for (const key of ["1", "0"]) map.set(key, key);
console.log("map", JSON.stringify([...map]));

const negatives = [1.5, 2.5];
for (const key of [Math.round(-0.2), 1]) negatives[key] = key;
console.log("negative zero", Object.is(negatives[0], -0), JSON.stringify(negatives));
const negativeFloats = new Float64Array(2);
for (const key of [Math.round(-0.2), 1]) negativeFloats[key] = key;
console.log("negative zero in a view", Object.is(negativeFloats[0], -0), JSON.stringify([...negativeFloats]));
