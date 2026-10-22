function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

const { freeze: pulledOut } = Object;
const Renamed = Object;
const flag = JSON.parse("true");
const tools = { close: Object.freeze };

function callWith(callee, input) {
  return callee(input);
}

function pick() {
  return Object.freeze;
}

class ByPlainCall {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByForEach {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByMap {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class BySome {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByArrayFrom {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class BySetForEach {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByValues {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByThen {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByCall {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByBind {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByReflectApply {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByPattern {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByBrackets {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByJoinedName {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByOtherName {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByCondition {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByMember {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByParameter {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByResult {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByHolder {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class BySeal {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByPreventExtensions {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

class ByReflectPreventExtensions {
  constructor() { this.width = 3; this.height = 4; }
  area() { return this.width * this.height; }
  store(value) { this.width = value; return this.width; }
  add() { this.depth = 6; return this.depth; }
  drop() { return delete this.height; }
}

const rows = [
  ["Object.freeze(box)", () => new ByPlainCall(), box => Object.freeze(box)],
  ["[box].forEach(Object.freeze)", () => new ByForEach(), box => [box].forEach(Object.freeze)],
  ["[box].map(Object.freeze)", () => new ByMap(), box => [box].map(Object.freeze)],
  ["[box].some(Object.freeze)", () => new BySome(), box => [box].some(Object.freeze)],
  ["Array.from([box], Object.freeze)", () => new ByArrayFrom(), box => Array.from([box], Object.freeze)],
  ["new Set([box]).forEach(Object.freeze)", () => new BySetForEach(), box => new Set([box]).forEach(Object.freeze)],
  ["Object.values({ box }).forEach(Object.freeze)", () => new ByValues(), box => Object.values({ box }).forEach(Object.freeze)],
  ["Promise.resolve(box).then(Object.freeze)", () => new ByThen(), box => Promise.resolve(box).then(Object.freeze)],
  ["Object.freeze.call(null, box)", () => new ByCall(), box => Object.freeze.call(null, box)],
  ["Object.freeze.apply(null, [box])", () => new ByApply(), box => Object.freeze.apply(null, [box])],
  ["Object.freeze.bind(null, box)()", () => new ByBind(), box => Object.freeze.bind(null, box)()],
  ["Reflect.apply(Object.freeze, null, [box])", () => new ByReflectApply(), box => Reflect.apply(Object.freeze, null, [box])],
  ["const { freeze } = Object; freeze(box)", () => new ByPattern(), box => pulledOut(box)],
  ["Object[\"freeze\"](box)", () => new ByBrackets(), box => Object["freeze"](box)],
  ["Object[joined name](box)", () => new ByJoinedName(), box => Object[["fre", "eze"].join("")](box)],
  ["const Renamed = Object; Renamed.freeze(box)", () => new ByOtherName(), box => Renamed.freeze(box)],
  ["(flag ? Object.freeze : Object.seal)(box)", () => new ByCondition(), box => (flag ? Object.freeze : Object.seal)(box)],
  ["tools.close(box), where close is Object.freeze", () => new ByMember(), box => tools.close(box)],
  ["a function that calls its parameter", () => new ByParameter(), box => callWith(Object.freeze, box)],
  ["a function that returns Object.freeze", () => new ByResult(), box => pick()(box)],
  ["Object.freeze(holder.box)", () => new ByHolder(), box => Object.freeze({ box }.box)],
  ["[box].forEach(Object.seal)", () => new BySeal(), box => [box].forEach(Object.seal)],
  ["[box].forEach(Object.preventExtensions)", () => new ByPreventExtensions(), box => [box].forEach(Object.preventExtensions)],
  ["[box].forEach(Reflect.preventExtensions)", () => new ByReflectPreventExtensions(), box => [box].forEach(each => Reflect.preventExtensions(each))],
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
