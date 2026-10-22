// The name of a function, read as a value from a closure that nothing has looked at before: declarations, arrows, expressions, methods, coroutines, classes, and closures of one function made many times.
function declared() {
  return 1;
}
const arrow = () => 2;
const expression = function () {
  return 3;
};
const named = function inner() {
  return 4;
};
async function waits() {
  return 5;
}
function* yields() {
  yield 6;
}
const holder = {
  method() {
    return 7;
  },
  property: () => 8,
  get accessor() {
    return 9;
  },
};
class Shape {
  area() {
    return 10;
  }
  static create() {
    return new Shape();
  }
}
function makeCounter(start: number) {
  return function counter() {
    return start++;
  };
}

const all: Function[] = [
  declared,
  arrow,
  expression,
  named,
  waits,
  yields,
  holder.method,
  holder.property,
  Shape,
  Shape.prototype.area,
  Shape.create,
  makeCounter,
  makeCounter(1),
  makeCounter(2),
];
for (const each of all) console.log(each.name, each.name.length, each.name === each.name, each.length);
for (let round = 0; round < 3; round++) console.log(makeCounter(round).name + "!");
console.log(Object.getOwnPropertyDescriptor(holder, "accessor")!.get!.name);
console.log(declared.bind(null).name);
console.log(all.map(each => each.name).join(","));
