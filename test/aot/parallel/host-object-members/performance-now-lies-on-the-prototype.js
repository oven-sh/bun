// performance.now is a method of Performance.prototype, and performance has no property of that name. A call on performance reads the clock. The function refuses every other receiver.
const { now } = Performance.prototype;
const outcome = run => {
  try {
    return typeof run();
  } catch (error) {
    return error.constructor.name + " " + error.code;
  }
};
console.log(Object.hasOwn(performance, "now"), Object.keys(performance).length, performance.now === now, typeof now);
console.log(
  outcome(() => performance.now()),
  outcome(() => now.call(performance)),
  outcome(() => Reflect.apply(now, performance, [])),
);
const heir = Object.create(performance);
console.log(
  outcome(() => now()),
  outcome(() => now.call({})),
  outcome(() => now.call(heir)),
  outcome(() => heir.now()),
  outcome(() => (0, performance.now)()),
);
function elapsed(from) {
  return performance.now() - from;
}
let least = Infinity;
for (let turn = 0; turn < 1000; turn++) least = Math.min(least, elapsed(0));
console.log(least > 0);
