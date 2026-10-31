// Each catch clause gets an error that the run time has made for an operation that failed by itself. The program reads it, stores into it, gives it another prototype and keeps it.
class Body {
  constructor(mass) {
    this.mass = mass;
  }
  weight() {
    return this.mass * 2;
  }
}
const world = [new Body(1), new Body(2)];
const seen = [];
const kept = [];
const nothing = process.argv.length > 99 ? world[0] : undefined;
const noFunction = process.argv.length > 99 ? world[0].weight : 7;

function describe(error) {
  return [
    typeof error,
    error instanceof Error,
    error.constructor.name,
    error.name,
    typeof error.message,
    typeof error.stack,
    error.mass,
    Object.keys(error).length,
  ].join(",");
}

try {
  nothing.mass;
} catch (error) {
  kept.push(error);
  seen.push(describe(error), error instanceof TypeError);
}
try {
  noFunction();
} catch (error) {
  kept.push(error);
  seen.push(describe(error), error === kept[0]);
}
try {
  seen.push(tooEarly);
  let tooEarly = 1;
} catch (error) {
  seen.push(describe(error), error instanceof ReferenceError);
}
try {
  1n + (process.argv.length > 99 ? 1n : 1);
} catch (error) {
  seen.push(describe(error));
}
try {
  new Array(process.argv.length > 99 ? 1 : -1);
} catch (error) {
  seen.push(describe(error), error instanceof RangeError);
}
try {
  JSON.parse(process.argv.length > 99 ? "1" : "{");
} catch (error) {
  seen.push(describe(error), error instanceof SyntaxError);
}
function forever(depth) {
  return forever(depth + 1) + 1;
}
try {
  forever(0);
} catch (error) {
  error.mass = 5;
  error.message = world[1];
  seen.push(error instanceof RangeError, error.mass, error.message.weight(), Object.keys(error).join("+"));
}
try {
  nothing.mass;
} catch (error) {
  Object.setPrototypeOf(error, Body.prototype);
  error.mass = 21;
  seen.push(error instanceof Error, error instanceof Body, error.weight());
  world.push(error);
}
TypeError.prototype.weight = function () {
  return "heavy " + this.name;
};
Object.defineProperty(TypeError.prototype, "mass", {
  get() {
    return 40;
  },
  configurable: true,
});
try {
  nothing.mass;
} catch (error) {
  seen.push(error.weight(), error.mass, kept[0].mass, kept[1].weight());
}
let total = 0;
for (const body of world) total += body.weight();
seen.push(total);
console.log(seen.join(" "));
