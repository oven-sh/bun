function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function length(point) {
  return Math.sqrt(point.x * point.x + point.y * point.y);
}

function moved(point, dx) {
  point.x += dx;
  point.y++;
  return point;
}

function cell(point) {
  return (point.x | 0) + "," + (point.y | 0);
}

function total(point) {
  return point.x + point.y;
}

for (let i = 0; i < 2000; i++) {
  const point = { x: i, y: 4 };
  length(point);
  moved(point, 1);
  cell(point);
  total(point);
}

const changes = {
  "x = '3'": point => {
    point.x = "3";
  },
  "x = 0.5": point => {
    point.x = 0.5;
  },
  "x = undefined": point => {
    point.x = undefined;
  },
  "delete x": point => {
    delete point.x;
  },
  "delete x and add it again": point => {
    delete point.x;
    point.x = 3;
  },
  "x = 3n": point => {
    point.x = 3n;
  },
  "x = 2147483647": point => {
    point.x = 2147483647;
  },
  "x = -0": point => {
    point.x = -0;
  },
  "x = an object": point => {
    point.x = { valueOf: () => 3 };
  },
  "x becomes a getter": point => {
    Object.defineProperty(point, "x", { get: () => 3.5, set() {}, enumerable: true });
  },
  "x is not writable": point => {
    Object.defineProperty(point, "x", { writable: false });
  },
  "frozen": point => {
    Object.freeze(point);
  },
  "another member is added": point => {
    point.z = "z";
  },
  "the prototype has x and the own one is deleted": point => {
    Object.setPrototypeOf(point, { x: "inherited" });
    delete point.x;
  },
  "both swapped for texts": point => {
    [point.x, point.y] = ["3", "4"];
  },
};

for (const name of Object.keys(changes)) {
  const make = () => {
    const point = { x: 3, y: 4 };
    changes[name](point);
    return point;
  };
  attempt(name + ": length", () => length(make()));
  attempt(name + ": total", () => total(make()));
  attempt(name + ": cell", () => cell(make()));
  attempt(name + ": moved", () => moved(make(), 1));
  attempt(name + ": moved by a text", () => moved(make(), "1"));
  attempt(name + ": keys", () => Object.keys(moved(make(), 1)));
}
attempt("an honest point afterwards", () => [length({ x: 3, y: 4 }), total({ x: 3, y: 4 }), cell({ x: 3, y: 4 }), moved({ x: 3, y: 4 }, 1)]);
