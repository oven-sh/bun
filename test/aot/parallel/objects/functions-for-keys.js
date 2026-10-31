// A function stands where a key is expected: the key is what the function converts to, each time anew.
function extension(type) {
  return type + ".ext";
}
function other(type) {
  return type;
}
const arrow = value => value;
async function later() {}
class Shape {
  area() {
    return 0;
  }
}
const bound = extension.bind(null);
const table = Object.create(null);
table["png"] = "image/png";
table[String(other)] = "text of other";
table["replaced"] = "under the replaced text";
table["primitive"] = "under the primitive";
table["123"] = "an element";

function read(key) {
  return String(table[key]);
}
function has(key) {
  return key in table;
}
function round(label) {
  const found = [];
  for (let turn = 0; turn < 3; turn++) {
    for (const key of [extension, other, arrow, later, Shape, bound, Shape.prototype.area]) found.push(read(key) + ":" + has(key));
  }
  console.log(label, found.slice(0, 7).join(" | "), found.slice(7, 14).join() === found.slice(0, 7).join() && found.slice(14).join() === found.slice(0, 7).join());
}
round("at first");

table[extension] = "stored under the function";
console.log(Object.keys(table).filter(key => key.startsWith("function extension")).length, table[String(extension)]);
round("stored");

// The function is given a conversion of its own.
other.toString = () => "replaced";
round("own toString");
delete other.toString;
round("own toString gone");
arrow[Symbol.toPrimitive] = () => "primitive";
round("own Symbol.toPrimitive");

// Another prototype object.
Object.setPrototypeOf(later, { toString: () => "replaced" });
round("another prototype");

// What all functions inherit is replaced, and put back.
const original = Function.prototype.toString;
try {
  Function.prototype.toString = function () {
    return "replaced";
  };
} catch (error) {
  console.log(error.constructor.name);
}
round("inherited toString");
try {
  Function.prototype.toString = original;
} catch (error) {
  console.log(error.constructor.name);
}
round("inherited toString put back");
round("at last");

// Many functions, each made anew, over a collection.
let count = 0;
for (let turn = 0; turn < 2000; turn++) {
  const made = function () {
    return turn;
  };
  if (table[made] === undefined) count++;
  if (turn % 500 === 0) Bun.gc(true);
  if (table[extension] === "stored under the function") count++;
}
console.log(count);
