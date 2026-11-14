"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};

const slice = Function.prototype.call.bind(Array.prototype.slice);
const isFunction = value => value instanceof Function;
const hasConstructor = value => value.constructor === Function;
tell(isFunction(slice), isFunction(1), hasConstructor(tell), typeof eval, typeof Function);
tell(Function.prototype.toString.call(slice).includes("native code"), slice([1, 2, 3], 1).join());

class Watched {
  static [Symbol.hasInstance](value) {
    return value === Function || value === eval;
  }
}
tell(Function instanceof Watched, eval instanceof Watched, slice instanceof Watched);

function Point(x) {
  this.x = x;
}
const run = count => {
  const list = new Array(1, true);
  list[0] = new Point(0.5);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (i > 5) list[1] = new Point(i);
    sum += list[i & 1].x === undefined ? 100 : list[i & 1].x;
  }
  return sum;
};
tell(run(3), run(20));

exports.held = 1;
module.exports.later = () => exports.held + 1;
tell(Object.keys(module.exports).join(), exports.later());
const Alias = Function;
tell(attempt(() => Alias.length), attempt(() => Alias.name), Alias.prototype === Function.prototype);
console.log(lines.join("\n"));
