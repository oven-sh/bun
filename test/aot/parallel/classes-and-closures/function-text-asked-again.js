// A function is asked for its text again and again: as a property key, which is what mime-types 3 does by accident about 2,500 times while it loads (`exports.types[extension]`, where
// `extension` is a function of the module), by String(), in a template and by toString(). Each text is what is written here. 2,000 answers of one function stay alive:
// object-census.test.ts runs it with BUN_JSC_dumpAOTObjectCensusAtExit=1 and counts the strings. The output is that of plain Bun.
function extension(type) {
  if (!type || typeof type !== "string") {
    return false;
  }
  return type.length > 3 ? type.slice(0, 3) : type;
}

const shorter = value => value + 1;

class Shape {
  area() { return 0; }
  static create() { return new Shape(); }
}

async function later() { return "später: ä ö ü"; }

function* counted() { yield 1; }

const types = Object.create(null);
types[extension] = "by the text of a function";
types.json = "application/json";

let found = 0;
for (let i = 0; i < 20000; i++) {
  if (types[extension] !== "application/octet-stream") found++;
  if (types[shorter] === undefined) found++;
}
console.log(found, Object.keys(types).length, Object.keys(types)[0] === extension.toString());

const kept = [];
for (let i = 0; i < 2000; i++) kept.push(extension.toString());
console.log(kept.length, kept.every(text => text === kept[0]), kept[0].length > 100);

// Plain Bun answers with the text that its transpiler printed and an executable with the text as written, so this prints what holds for both.
function show(callable, start, part) {
  const text = callable.toString();
  console.log(start, text.startsWith(start), text.includes(part), String(callable) === text, `${callable}` === text, Function.prototype.toString.call(callable) === text);
}
for (let round = 0; round < 2; round++) {
  show(extension, "function extension(type) {", "type.slice(0, 3)");
  show(shorter, "", "=> value + 1");
  show(Shape, "class Shape {", "static create()");
  show(Shape.prototype.area, "area() {", "return 0");
  show(Shape.create, "create() {", "new Shape");
  show(later, "async function later() {", "ter: ");
  show(counted, "function* counted() {", "yield 1");
  show(show, "function show(callable, start, part) {", "console.log(");
  show(extension.bind(null), "function extension() { [native code] }", "native");
  show(Math.max, "function max() { [native code] }", "native");
  if (typeof Bun !== "undefined") Bun.gc(true);
}
console.log(kept[1999] === extension.toString(), shorter.toString() !== extension.toString(), later.toString() !== counted.toString());
