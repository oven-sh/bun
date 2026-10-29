// Stack frames of small functions of one factory one of which gets a display name in the middle of a loop.
const top = (s, n = 3) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const handedBack = new Function("v", "return v" + String(process.argv.length).slice(9));
let wanted = false;
function probe(v) {
  return wanted ? new Error("x").stack : v;
}
const make = v =>
  function small() {
    return probe(v);
  };
const makeGetter = v => () => probe(v);
const list = handedBack([make("a"), make("b"), make("c")]);
const [first, second, third] = list;
const table = {};
for (const key of ["x", "y", "z"]) Object.defineProperty(table, key, { get: makeGetter(key), enumerable: true, configurable: true });
handedBack(table);

function readAll() {
  return [first(), second(), third(), table.x, table.y, table.z];
}
function show(label) {
  wanted = true;
  console.log(label, readAll().map(s => top(s)).join(" / "));
  wanted = false;
}

let length = 0;
show("as written:");
for (let i = 0; i < 6000; i++) {
  if (i === 2000) {
    handedBack(list)[1].displayName = "second of three";
    show("one has a display name:");
  }
  if (i === 4000) {
    Object.getOwnPropertyDescriptor(handedBack(table), "y").get.displayName = "getter of y";
    show("a getter has one too:");
  }
  length += readAll().join("").length;
}
show("behind the loop:");
delete handedBack(list)[1].displayName;
handedBack(list)[2].displayName = "third of three";
show("another one:");
console.log(length);
