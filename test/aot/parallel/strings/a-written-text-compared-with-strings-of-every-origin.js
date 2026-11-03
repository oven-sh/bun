// `x === "circle"` in a hot loop, without types and with strings from every place a string can come from.
// Strings out of JSON.parse are atoms, so the comparison asks whether they are one pointer with the atom of the text. Every other
// string has to come to the same answer: a rope, a slice, a 16-bit string, a string that becomes an atom later.
function isCircle(x) {
  return x === "circle";
}
function isLongerText(x) {
  return x === "a text that is too long to be compared in place, whatever the limit is, because it goes on and on";
}
function kindOf(x) {
  if (x === "get") return 1;
  if (x === "put") return 2;
  if (x === "post") return 3;
  if (x === "delete") return 4;
  return 0;
}

const wideCircle = "circleሴ".slice(0, 6);
const longCircle = "a circle in a long string".slice(2, 8);
function rope() {
  return "cir" + String(numberOfRopes++ % 2 ? "cle" : "cle");
}
let numberOfRopes = 0;

function values() {
  const parsed = JSON.parse('{"kind":"circle","other":"square","shorter":"circl","longer":"circles","empty":""}');
  const key = "ci" + "rc" + "le".repeat(1);
  const made = {};
  made[key] = 1;
  return [
    parsed.kind,
    parsed.other,
    parsed.shorter,
    parsed.longer,
    parsed.empty,
    "circle",
    "square",
    rope(),
    longCircle,
    wideCircle,
    key,
    Object.keys(made)[0],
    Object.keys(JSON.parse('{"circle":1}'))[0],
    ["circle"].join(""),
    String.fromCharCode(99, 105, 114, 99, 108, 101),
    "CIRCLE".toLowerCase(),
    new String("circle"),
    1,
    null,
    undefined,
    true,
    {},
    Symbol.iterator,
    10n,
  ];
}

const list = values();
let answers = "";
for (const value of list) {
  let count = 0;
  for (let turn = 0; turn < 3000; turn++) if (isCircle(value)) count++;
  answers += count ? "1" : "0";
}
console.log(answers);

let flattened = "cir" + rope().slice(3);
let before = 0;
for (let turn = 0; turn < 3000; turn++) if (isCircle(flattened)) before++;
const asKey = { [flattened]: 1 };
let after = 0;
for (let turn = 0; turn < 3000; turn++) if (isCircle(flattened)) after++;
console.log(before, after, Object.keys(asKey).length);

const longText = JSON.parse('["a text that is too long to be compared in place, whatever the limit is, because it goes on and on"]')[0];
let long = 0;
for (let turn = 0; turn < 3000; turn++) if (isLongerText(longText)) long++;
console.log(long);

const methods = JSON.parse('["get","put","post","delete","patch","ge"]');
methods.push("po" + "st".repeat(1), "get".slice(0));
let sum = 0;
for (let turn = 0; turn < 3000; turn++) for (let i = 0; i < methods.length; i++) sum += kindOf(methods[i]);
console.log(sum);

// The texts above are compared and never written as the name of a property. As names that come up at run time they work like any other.
const record = JSON.parse('{"circle":7,"square":8,"get":9,"other":10}');
const names = ["cir" + "cle".repeat(1), "square", "g" + "et".repeat(1), "other", "missing"];
let total = 0;
for (let turn = 0; turn < 3000; turn++) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name in record) total += record[name];
    if (isCircle(name)) total += 100;
    total += kindOf(name);
  }
}
console.log(total);
const own = {};
for (const name of names) own[name] = name.length;
delete own.circle;
let listed = "";
for (const name in own) listed += (isCircle(name) ? "!" : "") + name + " ";
console.log(listed, Object.hasOwn(own, "circle"), Symbol.for("circle").description === "circle", isCircle(Symbol.for("circle").description), isCircle(Symbol("circle")));
class Shape {
  static circle = 1;
  circle() {
    return "circle";
  }
}
let fromMethods = 0;
for (let turn = 0; turn < 3000; turn++) for (const name of Object.getOwnPropertyNames(Shape.prototype)) if (isCircle(name) && isCircle(new Shape()[name]())) fromMethods++;
console.log(fromMethods);
