class Stack extends Array {
  push() {
    return 42;
  }
  map() {
    return "mapped";
  }
}

export function makeList() {
  const list = [1, 2, 3];
  Object.setPrototypeOf(list, Stack.prototype);
  return list;
}

export function makeNumbers() {
  const list = [1, 2, 3];
  list[1] = JSON.parse('"two"');
  return list;
}

export function makeHoles() {
  const list = [1, 2, 3];
  delete list[1];
  return list;
}

export function makePoint() {
  const point = { x: 1, y: 2 };
  Object.defineProperty(point, "x", { get() { return "got"; }, enumerable: true });
  return point;
}

export function makeShortPoint() {
  const point = { x: 1, y: 2 };
  delete point.y;
  return point;
}

export function makeCount() {
  let count = 0;
  count = globalThis.String(count + 5);
  return count;
}

export function makeName() {
  const name = "abc";
  return Object(name);
}

export function makeStep() {
  const step = function (n) {
    return n + 1;
  };
  return new Proxy(step, { apply() { return "trapped"; } });
}

export const settings = { depth: 1, name: "settings", tags: ["a"] };

export function spoil() {
  settings.depth = JSON.parse('"deep"');
  settings.tags = JSON.parse('{"length":1,"0":"z"}');
  delete settings.name;
}

export let counter = 0;

export function spoilCounter() {
  counter = JSON.parse('"many"');
}

export class Box {
  constructor(value) {
    this.value = value;
    this.size = 1;
  }
  grow() {
    this.size = this.size + 1;
    return this.size;
  }
}

export function callBack(f) {
  return [f("8"), f(null), f({ valueOf() { return 4; } })];
}
