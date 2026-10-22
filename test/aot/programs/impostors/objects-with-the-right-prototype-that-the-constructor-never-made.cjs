function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function Vector(dx, dy) {
  this.dx = dx;
  this.dy = dy;
}
Vector.prototype.lengthSquared = function () {
  return this.dx * this.dx + this.dy * this.dy;
};
Vector.prototype.scale = function (factor) {
  this.dx *= factor;
  this.dy *= factor;
  return this;
};
Vector.prototype.plus = function (other) {
  return new Vector(this.dx + other.dx, this.dy + other.dy);
};

class Arrow {
  constructor(dx, dy) {
    this.dx = dx;
    this.dy = dy;
  }
  lengthSquared() {
    return this.dx * this.dx + this.dy * this.dy;
  }
  scale(factor) {
    this.dx *= factor;
    this.dy *= factor;
    return this;
  }
  plus(other) {
    return new Arrow(this.dx + other.dx, this.dy + other.dy);
  }
}

function lengthSquaredOf(vector) {
  return vector.lengthSquared();
}

function scaled(vector) {
  return vector.scale(2);
}

function added(vector, other) {
  return vector.plus(other);
}

for (const Maker of [Vector, Arrow]) {
  const impostors = [
    ["Object.create alone", () => Object.create(Maker.prototype)],
    ["Object.create with descriptors", () => Object.create(Maker.prototype, { dx: { value: 3, writable: true, enumerable: true }, dy: { value: 4, writable: true, enumerable: true } })],
    ["Object.create with values that cannot be written", () => Object.create(Maker.prototype, { dx: { value: 3, enumerable: true }, dy: { value: 4, enumerable: true } })],
    ["Object.create, then the fields in the other order", () => Object.assign(Object.create(Maker.prototype), { dy: 4, dx: 3 })],
    ["Object.create, then one field only", () => Object.assign(Object.create(Maker.prototype), { dx: 3 })],
    ["a literal moved under the prototype", () => Object.setPrototypeOf({ dx: 3, dy: 4 }, Maker.prototype)],
    ["a literal with __proto__", () => ({ __proto__: Maker.prototype, dy: 4, extra: true, dx: 3 })],
    ["a literal with getters moved under the prototype", () => Object.setPrototypeOf({ get dx() { return 3; }, get dy() { return 4; } }, Maker.prototype)],
    ["an array moved under the prototype", () => Object.setPrototypeOf(Object.assign([], { dx: 3, dy: 4 }), Maker.prototype)],
    ["a function moved under the prototype", () => Object.setPrototypeOf(Object.assign(function () {}, { dx: 3, dy: 4 }), Maker.prototype)],
    ["parsed JSON moved under the prototype", () => Object.setPrototypeOf(JSON.parse('{"dy":4,"dx":3}'), Maker.prototype)],
    ["parsed JSON with strings moved under the prototype", () => Object.setPrototypeOf(JSON.parse('{"dx":"3","dy":"4"}'), Maker.prototype)],
    ["Reflect.construct of Object for the maker", () => Object.assign(Reflect.construct(Object, [], Maker), { dx: 3, dy: 4 })],
    ["a child that forgot to call its parent", () => { function Child() { this.own = 1; } Child.prototype = Object.create(Maker.prototype); return new Child(); }],
    ["the prototype itself", () => Maker.prototype],
    ["an instance as the prototype of another object", () => Object.create(new Maker(3, 4))],
  ];

  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += lengthSquaredOf(scaled(added(new Maker(i % 3, 1), new Maker(1, 1))));
  console.log(Maker.name, "2000 honest rounds", sum);

  for (const [label, make] of impostors) {
    const steps = [
      ["instanceof", () => make() instanceof Maker],
      ["lengthSquared()", () => lengthSquaredOf(make())],
      ["scale(2)", () => { const made = make(); const result = scaled(made); return [result === made, Object.keys(made).join(), made.dx, made.dy]; }],
      ["plus an honest one", () => added(make(), new Maker(1, 1))],
      ["an honest one plus it", () => added(new Maker(1, 1), make())],
    ];
    for (const [step, run] of steps) {
      let line = Maker.name + ", " + label + ": " + step + " -> ";
      try {
        line += show(run());
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
    }
  }
  delete Maker.prototype.dx;
  delete Maker.prototype.dy;
  console.log(Maker.name, "honest again", show(scaled(added(new Maker(1, 2), new Maker(3, 4)))));
}
