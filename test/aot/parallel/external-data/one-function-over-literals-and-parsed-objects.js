function size(shape) {
  if (shape.kind === "circle") return shape.radius + shape.radius;
  return shape.side;
}

const shapes = [];
for (let i = 0; i < 64; i++) shapes.push(i % 3 ? { kind: "circle", radius: i + 0.5 } : { kind: "square", side: i + 0.25 });
const text = JSON.stringify(shapes);
const parsed = JSON.parse(text);
const root = JSON.parse(`{"items":${text}}`);

function sizesOfLiterals() {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) sum += size(shapes[i]);
  return sum;
}
function sizesOf(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += size(list[i]);
  return sum;
}
function sizesOfParsed() {
  let sum = 0;
  for (let i = 0; i < parsed.length; i++) sum += size(parsed[i]);
  return sum;
}
function sizesUnderMember() {
  let sum = 0;
  for (let i = 0; i < root.items.length; i++) sum += size(root.items[i]);
  return sum;
}
function textsOfParsed() {
  let all = "";
  for (let i = 0; i < parsed.length; i++) all += size(parsed[i]) + ",";
  return all.length;
}

function run(name, f) {
  let last;
  for (let turn = 0; turn < 300; turn++) last = f();
  console.log(name, last);
}

run("literals", sizesOfLiterals);
run("parsed", sizesOfParsed);
run("under a member", sizesUnderMember);
run("as text", textsOfParsed);
run("through a parameter", () => sizesOf(parsed));

// The same names in other forms, and values that no number test lets through.
parsed[1].radius = "text";
run("a text for a radius", sizesOfParsed);
parsed[1].radius = 10n;
try {
  sizesOfParsed();
} catch (error) {
  console.log("a bigint for a radius", error.constructor.name);
}
parsed[1].radius = { valueOf: () => 7 };
run("an object for a radius", sizesOfParsed);
parsed[1].radius = 1.5;

// What the guess of the literals would pass after all: a literal among the parsed objects.
parsed[2] = { kind: "circle", radius: 100 };
parsed[3] = { kind: "square", side: 200 };
run("literals among them", sizesOfParsed);
parsed[2] = JSON.parse(`{"radius":2.5,"kind":"circle"}`);
run("another order", sizesOfParsed);
parsed[3] = Object.create(JSON.parse(`{"kind":"square","side":3.5}`));
run("inherited", sizesOfParsed);
Object.defineProperty(parsed[4], "radius", { get: () => 41 });
run("a getter", sizesOfParsed);
delete parsed[5].radius;
run("deleted", () => String(sizesOfParsed()));
parsed[5].radius = 1;
Object.freeze(parsed[7]);
run("frozen", sizesOfParsed);
parsed[8] = new Proxy(JSON.parse(`{"kind":"circle","radius":9}`), {
  get(target, name) {
    return name === "radius" ? 1000 : target[name];
  },
});
run("a proxy", sizesOfParsed);
parsed[9] = null;
try {
  sizesOfParsed();
} catch (error) {
  console.log("null", error.constructor.name);
}
parsed[9] = "a string";
run("a string", () => String(sizesOfParsed()));
parsed[9] = 12;
run("a number", () => String(sizesOfParsed()));

// Handed to the function by a for-of, or right out of JSON.parse. These look at the second list, which nothing above has changed.
const again = JSON.parse(text);
const lines = [];
for (let i = 0; i < shapes.length; i++) lines.push(JSON.stringify(shapes[i]));
function sizesByForOf() {
  let sum = 0;
  for (const shape of again) sum += size(shape);
  return sum;
}
function sizesOfLines() {
  let sum = 0;
  for (let i = 0; i < lines.length; i++) sum += size(JSON.parse(lines[i]));
  return sum;
}
function scaled(shape, by) {
  return shape.radius * by;
}
function scaledByForOf() {
  let sum = 0;
  for (const shape of again) sum += scaled(shape, 2) || 0;
  return sum;
}
run("for of", sizesByForOf);
run("each line", sizesOfLines);
run("beside an integer", scaledByForOf);
console.log("a literal", scaled({ radius: 3 }, 1));
again[1] = { kind: "circle", radius: 100 };
again[2] = new Proxy(JSON.parse(`{"kind":"circle","radius":9}`), {
  get(target, name) {
    return name === "radius" ? 1000 : target[name];
  },
});
run("for of, a literal and a proxy among them", sizesByForOf);
lines[1] = `{"kind":"circle","radius":"text"}`;
run("each line, a text for a radius", () => String(sizesOfLines()));
