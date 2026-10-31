// A key made of constants of the module, in a function that may run ahead of them: behind the tests of the variables it is a written name, and the message for `undefined` or `null` names it.
const moduleKey = "x";
const twoWords = "two words";
const asWritten = message => message.replace(/'(undefined|null)([.\[])/, "'o$2").replace(" = 1'", "'");
const place = error =>
  error.stack
    .split("\n")
    .slice(1, 2)
    .map(line => line.replace(/^.*?([a-zA-Z]+) \(.*:(\d+:\d+)\)$/, "$1@$2"))
    .join();
function read(o) {
  return o[moduleKey + ""];
}
function readAlone(o) {
  return o[moduleKey];
}
function readTemplate(o) {
  return o[`${moduleKey}`];
}
function readJoined(o) {
  return o[moduleKey + moduleKey];
}
function readTwoWords(o) {
  return o[twoWords + ""];
}
function store(o) {
  o[moduleKey + ""] = 1;
}
function increment(o) {
  o[moduleKey + ""]++;
}
function incrementInFront(o) {
  ++o[moduleKey + ""];
}
function incrementTwoWords(o) {
  o[twoWords + ""]++;
}
function add(o) {
  o[moduleKey + ""] += 1;
}
function storeIfNullish(o) {
  o[moduleKey + ""] ??= 1;
}
function storeIfFalse(o) {
  o[moduleKey + ""] ||= 1;
}
function call(o) {
  return o[moduleKey + ""]();
}
function madeAtRunTime(o, k) {
  o[k + ""]++;
}
const holder = () => ({
  get x() {
    throw new Error("getter");
  },
  set x(value) {
    throw new Error("setter");
  },
  get xx() {
    throw new Error("getter");
  },
  get "two words"() {
    throw new Error("getter");
  },
});
for (const f of [
  read,
  readAlone,
  readTemplate,
  readJoined,
  readTwoWords,
  store,
  increment,
  incrementInFront,
  incrementTwoWords,
  add,
  storeIfNullish,
  storeIfFalse,
  call,
  madeAtRunTime,
]) {
  for (const o of [undefined, null, holder()]) {
    try {
      console.log(f.name, "answers", f(o, "x"));
    } catch (error) {
      console.log(f.name, asWritten(error.message), place(error));
    }
  }
}
function early(o) {
  return o[late + ""];
}
try {
  early({});
} catch (error) {
  console.log(error.name, error.message);
}
const late = "x";
console.log(early({ x: "read" }));
