function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Circle(size) {
  this.size = size;
}
Circle.prototype.measure = function () {
  return "circle " + this.size * 3;
};

function Ring(size) {
  this.hole = 1;
  this.size = size;
}
Ring.prototype.measure = function () {
  return "ring " + (this.size - this.hole);
};

class Disk {
  constructor(size) {
    this.size = size;
  }
  measure() {
    return "disk " + this.size;
  }
}

const table = {
  Circle,
  Ring,
  Disk,
  bound: Circle.bind(null, 100),
  proxy: new Proxy(Ring, {}),
  trap: new Proxy(Circle, { construct(target, inputs) { return { size: "from the trap", measure: () => "trapped " + inputs[0] }; } }),
  returnsLiteral: function (size) { return { size, measure() { return "literal " + this.size; } }; },
  arrow: size => ({ size }),
  method: { method(size) { this.size = size; } }.method,
  async: async function (size) { this.size = size; },
  generator: function* (size) { this.size = size; },
  getter: Object.getOwnPropertyDescriptor({ get size() { return 1; } }, "size").get,
  number: 5,
  literal: { size: 1 },
  Object,
  Array,
  String,
  Symbol,
};

function makeFromParameter(Maker, size) {
  return new Maker(size);
}

function makeFromTable(name, size) {
  return new table[name](size);
}

function makeFromVariable(name, size) {
  let Maker = Circle;
  if (name !== "Circle") Maker = table[name];
  return new Maker(size);
}

function makeFromJoinedName(head, tail, size) {
  return new table[head + tail](size);
}

function measure(shape) {
  return shape.measure();
}

let length = 0;
for (let i = 0; i < 2000; i++) {
  length += measure(makeFromParameter(Circle, i % 5)).length;
  length += measure(makeFromTable("Circle", i % 5)).length;
  length += measure(makeFromVariable("Circle", i % 5)).length;
  length += measure(makeFromJoinedName("Cir", "cle", i % 5)).length;
}
console.log("2000 circles each way", length);

for (const name of [...Object.keys(table), "missing"]) {
  const ways = [
    ["a parameter", () => makeFromParameter(table[name], 4)],
    ["the table", () => makeFromTable(name, 4)],
    ["a variable", () => makeFromVariable(name, 4)],
    ["a joined name", () => makeFromJoinedName(name.slice(0, 2), name.slice(2), 4)],
  ];
  for (const [way, make] of ways) {
    attempt(name + " from " + way, () => {
      const made = make();
      let measured;
      try {
        measured = measure(made);
      } catch (error) {
        measured = "measure threw " + error.constructor.name;
      }
      return [typeof made, show(made), measured, made instanceof Circle].join(" | ");
    });
  }
  attempt("a circle again", () => measure(makeFromTable("Circle", 2)));
}
