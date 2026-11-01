// Each loop hands lists that somebody kept on to a function: `f.apply(null, kept)`: arrays, arguments objects of a sloppy function, which are mapped, and objects that only look like lists.
// Nothing was done to the arguments objects, so their length and their elements are plain data. An object that looks like a list is asked for each.
const bound = function (a, b, c) {
  return a + b + c;
}.bind(null);
function keepsMapped() {
  return arguments;
}
const mapped = [keepsMapped(1, 2, 3), keepsMapped(4, 5, 6), keepsMapped(7, 8, 9), keepsMapped(10, 11, 12)];
const alike = [{ length: 3, 0: 1, 1: 2, 2: 3 }, { length: 3, 0: 4, 1: 5, 2: 6 }, { length: 3, 0: 7, 1: 8, 2: 9 }, { length: 3, 0: 10, 1: 11, 2: 12 }];
const arrays = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]];
const loops = {
  arrays(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += bound.apply(null, arrays[i & 3]);
    return sum;
  },
  alike(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += bound.apply(null, alike[i & 3]);
    return sum;
  },
  mapped(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += bound.apply(null, mapped[i & 3]);
    return sum;
  },
};

// What a mapped arguments object may have had done to it, and what `apply` then sees.
function changed(a, b, c) {
  const seen = [];
  const show = function () {
    return Array.prototype.join.call(arguments, ",") + "/" + arguments.length;
  }.bind(null);
  seen.push(show.apply(null, arguments));
  a = "stored to the parameter";
  seen.push(show.apply(null, arguments));
  arguments[1] = "stored to the element";
  seen.push(show.apply(null, arguments), String(b));
  arguments[5] = "beyond the length";
  seen.push(show.apply(null, arguments));
  delete arguments[0];
  seen.push(show.apply(null, arguments));
  Object.defineProperty(arguments, "2", { get: () => "from a getter", configurable: true });
  seen.push(show.apply(null, arguments));
  arguments.length = 2;
  seen.push(show.apply(null, arguments));
  arguments.length = 7;
  seen.push(show.apply(null, arguments));
  return seen.join(" | ");
}
function frozen(a, b) {
  Object.freeze(arguments);
  a = "not seen";
  return bound.apply(null, arguments) + "/" + Reflect.apply(bound, null, arguments);
}
function fewer(a, b, c) {
  c = "a parameter that was not passed";
  return String(bound.apply(null, arguments));
}
function constructs() {
  return JSON.stringify(Reflect.construct(function (a, b) { this.a = a; this.b = b; }.bind(null), arguments));
}

const which = process.argv[2] ?? "";
const turns = Number(process.argv[3] ?? "64");
if (which) console.log(which, loops[which](turns));
else {
  for (const name in loops) console.log(name, loops[name](turns));
  for (let i = 0; i < 3; i++) console.log(changed(1, 2, 3), "\n", frozen(1, 2, 3), fewer(1, 2), constructs(4, 5, 6));
}
