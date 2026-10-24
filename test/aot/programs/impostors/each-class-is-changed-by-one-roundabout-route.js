function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const parsedName = JSON.parse('"width"');
const other = { area: () => "another area" };

function callWith(callee, ...inputs) {
  return callee(...inputs);
}

function makeTable() {
  return { width: { get: () => "from the table", configurable: true } };
}

class DeletedByApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class DeletedByParsedName {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class DeletedByLoop {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class DeletedByParameter {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RedefinedByApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RedefinedByParameter {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RedefinedByProperties {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RedefinedByOldWay {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class MovedByParameter {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class MovedByJoinedName {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class MovedByReflectApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class MovedByAssign {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RetypedByParsedName {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RetypedByAssignApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RetypedByReflectSet {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RetypedByEntries {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class RetypedByPattern {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ParentOfAnother {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

const rows = [
  ["Reflect.deleteProperty.apply(null, [box, name])", () => new DeletedByApply(), box => Reflect.deleteProperty.apply(null, [box, "width"])],
  ["delete box[a name from JSON]", () => new DeletedByParsedName(), box => delete box[parsedName]],
  ["for (name in box) delete box[name]", () => new DeletedByLoop(), box => { for (const name in box) delete box[name]; }],
  ["a function that calls its parameter with Reflect.deleteProperty", () => new DeletedByParameter(), box => callWith(Reflect.deleteProperty, box, "width")],
  ["Object.defineProperty.apply", () => new RedefinedByApply(), box => Object.defineProperty.apply(Object, [box, "width", { get: () => "got", configurable: true }])],
  ["a function that calls its parameter with Object.defineProperty", () => new RedefinedByParameter(), box => callWith(Object.defineProperty, box, "width", { value: "fixed", writable: false })],
  ["Object.defineProperties with a table from a function", () => new RedefinedByProperties(), box => Object.defineProperties(box, makeTable())],
  ["__defineGetter__", () => new RedefinedByOldWay(), box => box.__defineGetter__("width", () => "got the old way")],
  ["a function that calls its parameter with Object.setPrototypeOf", () => new MovedByParameter(), box => callWith(Object.setPrototypeOf, box, other)],
  ["box[joined __proto__] = other", () => new MovedByJoinedName(), box => void (box[["__pro", "to__"].join("")] = other)],
  ["Reflect.apply(Reflect.setPrototypeOf, ..)", () => new MovedByReflectApply(), box => Reflect.apply(Reflect.setPrototypeOf, null, [box, other])],
  ["Object.assign from a source with an own __proto__", () => new MovedByAssign(), box => Object.assign(box, JSON.parse('{"__proto__":{"inherited":true}}'))],
  ["box[a name from JSON] = a string", () => new RetypedByParsedName(), box => void (box[parsedName] = "text")],
  ["Object.assign.apply", () => new RetypedByAssignApply(), box => Object.assign.apply(null, [box, { width: "assigned" }])],
  ["a function that calls its parameter with Reflect.set", () => new RetypedByReflectSet(), box => callWith(Reflect.set, box, "width", "set")],
  ["entries of parsed JSON are stored one by one", () => new RetypedByEntries(), box => Object.entries(JSON.parse('{"width":1.5,"extra":true}')).forEach(([name, value]) => { box[name] = value; })],
  ["a pattern with a computed target", () => new RetypedByPattern(), box => [box[parsedName]] = ["from a pattern"]],
  ["Object.create reached through a parameter, then a store to the child", () => new ParentOfAnother(), box => void (callWith(Object.create, box).width = 9)],
];

function look(box) {
  const steps = [() => box.width, () => box.area(), () => box.store(5), () => box.add(), () => box.drop(), () => Object.keys(box).join()];
  return steps
    .map(step => {
      try {
        return show(step());
      } catch (error) {
        return error.constructor.name;
      }
    })
    .join(" ");
}

for (let i = 0; i < 2000; i++) {
  for (const [, make] of rows) {
    const box = make();
    box.store(i % 7);
    box.add();
    box.drop();
    box.area();
  }
}

for (const [label, make, change] of rows) {
  console.log(label + " | untouched -> " + look(make()));
  const box = make();
  let line = label + " | changed -> ";
  try {
    await change(box);
    line += look(box);
  } catch (error) {
    line += "the change threw " + error.constructor.name;
  }
  console.log(line);
}
