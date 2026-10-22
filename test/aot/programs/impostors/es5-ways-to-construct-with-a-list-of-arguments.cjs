function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function Segment(start, end, label) {
  this.start = start;
  this.end = end;
  if (arguments.length > 2) this.label = label;
  this.count = arguments.length;
}
Segment.prototype.size = function () {
  return this.end - this.start;
};

function Flexible() {
  if (!(this instanceof Flexible)) {
    var made = Object.create(Flexible.prototype);
    Flexible.apply(made, arguments);
    return made;
  }
  this.start = arguments[0];
  this.end = arguments[1];
  this.count = arguments.length;
}
Flexible.prototype.size = Segment.prototype.size;

class Modern {
  constructor(start, end) {
    this.start = start;
    this.end = end;
    this.count = arguments.length;
  }
  size() {
    return this.end - this.start;
  }
}

function sizeOf(segment) {
  return segment.size();
}

function startOf(segment) {
  return segment.start;
}

var ways = [
  ["new", function (Maker, list) { return new Maker(list[0], list[1]); }],
  ["new with a spread", function (Maker, list) { return new Maker(...list); }],
  ["Object.create, then apply", function (Maker, list) { var made = Object.create(Maker.prototype); var result = Maker.apply(made, list); return Object(result) === result ? result : made; }],
  ["Object.create, then call", function (Maker, list) { var made = Object.create(Maker.prototype); Maker.call(made, list[0], list[1]); return made; }],
  ["new of bind.apply", function (Maker, list) { return new (Function.prototype.bind.apply(Maker, [null].concat(list)))(); }],
  ["new of Maker.bind.apply", function (Maker, list) { return new (Maker.bind.apply(Maker, [null].concat(list)))(); }],
  ["new of a bound maker with the rest", function (Maker, list) { return new (Maker.bind(null, list[0]))(list[1]); }],
  ["Reflect.construct", function (Maker, list) { return Reflect.construct(Maker, list); }],
  ["Reflect.construct with an array-like", function (Maker, list) { return Reflect.construct(Maker, { length: 2, 0: list[0], 1: list[1] }); }],
  ["a temporary constructor", function (Maker, list) { function Temporary() { return Maker.apply(this, list); } Temporary.prototype = Maker.prototype; return new Temporary(); }],
  ["without new", function (Maker, list) { return Maker(list[0], list[1]); }],
  ["apply with undefined as this", function (Maker, list) { return Maker.apply(undefined, list); }],
];

var lists = [
  ["two numbers", [2, 9]],
  ["three values", [2, 9, "labeled"]],
  ["one number", [2]],
  ["nothing", []],
  ["strings", ["2", "9"]],
];

var sum = 0;
for (var i = 0; i < 2000; i++) sum += sizeOf(new Segment(i % 4, 10)) + sizeOf(new Flexible(i % 4, 10)) + sizeOf(new Modern(i % 4, 10)) + startOf(new Segment(1, 2));
console.log("2000 honest constructions each", sum);

[Segment, Flexible, Modern].forEach(function (Maker) {
  ways.forEach(function (way) {
    lists.forEach(function (list) {
      var line = Maker.name + " | " + way[0] + " | " + list[0] + " -> ";
      try {
        var made = way[1](Maker, list[1]);
        line += show(made);
        if (made !== undefined) line += " | instanceof " + (made instanceof Maker) + " | start " + show(startOf(made)) + " | size " + show(sizeOf(made));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line);
      ["start", "end", "label", "count"].forEach(function (name) { delete globalThis[name]; });
    });
  });
});
