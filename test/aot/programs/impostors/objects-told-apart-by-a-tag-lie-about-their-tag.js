const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function circle(radius) {
  return { kind: "circle", radius };
}

function square(side) {
  return { kind: "square", side };
}

function rectangle(wide, tall) {
  return { kind: "rectangle", wide, tall };
}

class Node {
  constructor(kind, payload) {
    this.kind = kind;
    this.payload = payload;
  }
}

function areaBySwitch(shape) {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
    case "rectangle":
      return shape.wide * shape.tall;
    default:
      return "unknown kind";
  }
}

function areaByIfs(shape) {
  if (shape.kind === "circle") return shape.radius * shape.radius * 3;
  if (shape.kind === "square") return shape.side * shape.side;
  if (shape.kind === "rectangle") return shape.wide * shape.tall;
  return "unknown kind";
}

function areaByTable(shape) {
  const table = {
    circle: each => each.radius * each.radius * 3,
    square: each => each.side * each.side,
    rectangle: each => each.wide * each.tall,
  };
  return table[shape.kind](shape);
}

function areaByMembers(shape) {
  if ("radius" in shape) return shape.radius * shape.radius * 3;
  if (shape.side !== undefined) return shape.side * shape.side;
  return shape.wide * shape.tall;
}

function growAfterTheTest(shape, between) {
  if (shape.kind === "circle") {
    between(shape);
    return [shape.kind, shape.radius];
  }
  return "not a circle";
}

function payloadOf(node) {
  return node.kind === "number" ? node.payload + 1 : node.kind === "text" ? node.payload.length : "unknown kind";
}

const uses = [
  ["switch", areaBySwitch],
  ["ifs", areaByIfs],
  ["table", areaByTable],
  ["members", areaByMembers],
];

const liars = [
  ["an honest circle", () => circle(2)],
  ["an honest square", () => square(2)],
  ["an honest rectangle", () => rectangle(2, 3)],
  ["a circle whose kind was stored to", () => Object.assign(circle(2), { kind: "square" })],
  ["a square whose kind was stored to", () => Object.assign(square(2), { kind: "circle" })],
  ["a circle that also got a side", () => Object.assign(circle(2), { side: 5 })],
  ["a circle that became a square with a side", () => Object.assign(circle(2), { kind: "square", side: 5 })],
  ["a literal that says circle and has a side", () => ({ kind: "circle", side: 2 })],
  ["a literal with the tag last", () => ({ radius: 2, kind: "circle" })],
  ["a kind nobody knows", () => ({ kind: "hexagon", radius: 2 })],
  ["no kind", () => ({ radius: 2 })],
  ["a kind with other letters", () => ({ kind: "Circle", radius: 2 })],
  ["a kind that is a String object", () => ({ kind: new String("circle"), radius: 2 })],
  ["a kind joined at run time", () => ({ kind: ["cir", "cle"].join(""), radius: 2 })],
  ["a kind that is a number", () => ({ kind: 0, radius: 2 })],
  ["a kind named like a member of Object.prototype", () => ({ kind: "constructor", radius: 2 })],
  ["a kind that is a getter and alternates", () => { let reads = 0; return { get kind() { log.push("get kind"); return reads++ % 2 ? "square" : "circle"; }, radius: 2, side: 5 }; }],
  ["a circle whose radius is a string", () => circle("2")],
  ["a circle whose radius was deleted", () => { const shape = circle(2); delete shape.radius; return shape; }],
  ["a circle from JSON", () => JSON.parse('{"kind":"circle","radius":2}')],
  ["a liar from JSON", () => JSON.parse('{"kind":"rectangle","radius":2}')],
  ["a frozen circle", () => Object.freeze(circle(2))],
  ["a class instance that says circle", () => Object.assign(new Node("circle", null), { radius: 2 })],
  ["null", () => null],
];

function look(phase) {
  for (const [label, make] of liars) {
    for (const [name, use] of uses) {
      let line = phase + " | " + label + " | " + name + " -> ";
      try {
        line += show(use(make()));
      } catch (error) {
        line += "threw " + error.constructor.name;
      }
      console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
    }
  }
}

look("at first");
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(i % 3 === 0 ? circle(i % 4) : i % 3 === 1 ? square(i % 4) : rectangle(i % 4, 2));
look("after 2000 honest shapes");

for (let i = 0; i < 2000; i++) growAfterTheTest(circle(1), () => {});
for (const [label, between] of [
  ["nothing", () => {}],
  ["stores another kind", shape => { shape.kind = "square"; }],
  ["deletes radius", shape => { delete shape.radius; }],
  ["deletes kind", shape => { delete shape.kind; }],
  ["stores a string radius", shape => { shape.radius = "wide"; }],
  ["copies another kind in from parsed JSON", shape => { Object.assign(shape, JSON.parse('{"kind":"rectangle","radius":null}')); }],
]) {
  console.log("after the test of the tag, a call " + label + " -> " + show(growAfterTheTest(circle(1), between)));
}

for (let i = 0; i < 2000; i++) payloadOf(i % 2 ? new Node("number", i) : new Node("text", "abc"));
for (const [label, make] of [
  ["a number node", () => new Node("number", 1)],
  ["a text node", () => new Node("text", "abc")],
  ["a number node that holds text", () => new Node("number", "abc")],
  ["a text node that holds a number", () => new Node("text", 5)],
  ["a text node that holds an array", () => new Node("text", [1, 2])],
  ["a text node that holds nothing", () => new Node("text")],
  ["a number node that holds a bigint", () => new Node("number", 1n)],
  ["a number node whose kind was stored to", () => Object.assign(new Node("number", 1), { kind: "text" })],
]) {
  let line = label + " -> ";
  try {
    line += show(payloadOf(make()));
  } catch (error) {
    line += "threw " + error.constructor.name;
  }
  console.log(line);
}
