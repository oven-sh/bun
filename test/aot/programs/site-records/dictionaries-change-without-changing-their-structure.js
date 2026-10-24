// An object with very many properties, or one that lost many, keeps its properties in a table of its own. Properties come, go and move while the object's structure stays the same one, so nothing that a site remembers by the structure holds.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler

class Expected {
  constructor() {
    this.name = "expected";
    this.count = 1;
  }
}

function nameOf(value) {
  return value.name;
}
function countOf(value) {
  return value.count;
}
function setName(value, name) {
  value.name = name;
}
function setCount(value, count) {
  value.count = count;
}
function state(mark, value) {
  const hidden = unknown(value);
  console.log(mark + ":", String(nameOf(hidden)), String(nameOf(hidden)), String(countOf(hidden)), "name" in value, Object.keys(value).length, Object.keys(value).slice(-3).join());
}

function large(count) {
  const value = {};
  for (let i = 0; i < count; i++) value["key" + i] = i;
  return value;
}
function thinned() {
  const value = { a: 1, b: 2, name: "thinned", c: 3, count: 5, d: 4 };
  delete value.a;
  delete value.c;
  delete value.b;
  return value;
}

function exercise(mark, value) {
  state(mark + ", at first", value);
  setName(unknown(value), "stored");
  setCount(unknown(value), 10);
  state(mark + ", stored", value);
  delete value.name;
  state(mark + ", name deleted", value);
  value.inTheOldPlace = "not the name";
  state(mark + ", another took its place", value);
  setName(unknown(value), "stored again");
  state(mark + ", name stored again", value);
  delete value.count;
  delete value.name;
  value.first = "not the count";
  value.second = "not the name";
  state(mark + ", both deleted, two added", value);
  setCount(unknown(value), 20);
  setName(unknown(value), "third");
  state(mark + ", both stored in the other order", value);
  Object.defineProperty(value, "name", { get: () => "getter", configurable: true, enumerable: true });
  state(mark + ", a getter", value);
  Object.defineProperty(value, "name", { value: "a value again", writable: true });
  state(mark + ", a value again", value);
  Object.defineProperty(value, "count", { writable: false });
  try {
    setCount(unknown(value), 30);
    console.log("stored to a read-only property");
  } catch (error) {
    console.log("throws", error.constructor.name);
  }
  state(mark + ", count is read-only", value);
  // Listing and copying may bring the table into a compact form.
  for (const key in value) if (key === "never") console.log(key);
  Object.assign({}, value);
  JSON.stringify(value);
  state(mark + ", after enumerations", value);
  delete value.second;
  setName(unknown(value), "last");
  state(mark + ", at last", value);
}

const withFields = large(300);
withFields.name = "large";
withFields.count = 2;
exercise("large", withFields);
state("expected", new Expected());
exercise("thinned", thinned());
state("expected", new Expected());

const instance = new Expected();
for (let i = 0; i < 300; i++) instance["more" + i] = i;
exercise("an instance that grew", instance);

const shrunk = new Expected();
for (let i = 0; i < 40; i++) shrunk["more" + i] = i;
for (let i = 0; i < 40; i++) delete shrunk["more" + i];
exercise("an instance that grew and shrank", shrunk);

const prototype = large(300);
prototype.name = "on a large prototype";
const heir = Object.create(prototype);
state("below a large prototype", heir);
delete prototype.name;
prototype.inTheOldPlace = "not the name";
state("deleted there", heir);
prototype.name = "there again";
state("there again", heir);
state("expected", new Expected());

export {};
