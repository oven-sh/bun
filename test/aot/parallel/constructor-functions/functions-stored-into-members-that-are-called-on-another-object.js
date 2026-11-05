// acorn's `types.name.updateContext = function (prevType) { .. this.exprAllowed = allowed }`, called as `update.call(this, prevType)`:
// a function stored into a member of an object stores into `this` and reads what it never stored, so it is no constructor. Beside it, functions in the same place that are.
const kinds = { name: { label: "name" }, brace: { label: "{" }, plain: { label: "plain" } };
kinds.name.update = function (previous) {
  let allowed = false;
  if (this.options.version >= 6 && previous !== kinds.brace) {
    if ((this.value === "of" && !this.allowed) || (this.value === "yield" && this.inGenerator())) allowed = true;
  }
  this.allowed = allowed;
};
kinds.brace.update = function () {
  this.context.push(this.context.length);
  this.allowed = true;
};
function Reader(version) {
  this.options = { version };
  this.value = "of";
  this.allowed = false;
  this.context = [];
}
Reader.prototype.inGenerator = function () {
  return this.context.length > 2;
};
Reader.prototype.step = function (kind, previous) {
  const update = kind.update;
  if (update) update.call(this, previous);
  else this.allowed = !this.allowed;
  return this.allowed;
};
const reader = new Reader(7);
const order = [kinds.name, kinds.brace, kinds.plain, kinds.name, kinds.brace, kinds.brace, kinds.name];
let count = 0;
for (let i = 0; i < 700; i++) {
  reader.value = i % 3 ? "of" : "yield";
  if (reader.step(order[i % 7], order[(i + 6) % 7])) count++;
  if (reader.context.length > 5) reader.context.length = 0;
}
console.log(count, reader.allowed, reader.context.join(), Object.keys(reader).join());

// The same functions on other receivers, and constructed after all.
const other = { options: { version: 5 }, value: "of", allowed: true };
kinds.name.update.call(other, kinds.plain);
console.log(JSON.stringify(other));
kinds.name.options = { version: 9 };
kinds.name.value = "of";
kinds.name.update(kinds.plain);
console.log(kinds.name.allowed, Object.keys(kinds.name).join());
try {
  new kinds.brace.update();
} catch (error) {
  console.log(error.constructor.name);
}
kinds.brace.update.prototype.context = [];
const made = new kinds.brace.update();
console.log(made.allowed, Object.keys(made).join(), made instanceof kinds.brace.update, made.context.length);

// Constructors stored into members: one reads only what it has stored, one reads what its prototype holds, one has its parent fill `this`.
const shapes = {};
shapes.Point = function (x, y) {
  this.x = x;
  this.y = y;
  this.sum = this.x + this.y;
};
shapes.Point.prototype.norm = function () {
  return this.x * this.x + this.y * this.y;
};
shapes.Circle = function (radius) {
  this.radius = radius;
  this.area = this.scale * radius * radius;
};
shapes.Circle.prototype.scale = 3;
shapes.Labeled = function (x, y, label) {
  shapes.Point.call(this, x, y);
  this.label = label + this.sum;
};
shapes.Labeled.prototype = Object.create(shapes.Point.prototype);
let total = 0;
for (let i = 0; i < 300; i++) {
  total += new shapes.Point(i, 1).norm() + new shapes.Circle(i).area + new shapes.Labeled(i, 2, "p").norm();
}
console.log(
  total,
  JSON.stringify(new shapes.Point(1, 2)),
  JSON.stringify(new shapes.Circle(2)),
  JSON.stringify(new shapes.Labeled(1, 2, "l")),
);
console.log(new shapes.Labeled(1, 2, "l") instanceof shapes.Point, Object.keys(new shapes.Circle(1)).join());
