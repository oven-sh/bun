// A helper applies a generator function. What the handler of its try block names is seen by others.
const common = Object.getPrototypeOf(function* () {}).prototype;
const look = generator => [Object.getPrototypeOf(generator) === common, Object.getPrototypeOf(Object.getPrototypeOf(generator)) === common];

let failures = 0;
function driveAndReturn(generatorFunction) {
  let generator = null;
  try {
    generator = generatorFunction.apply(null, []);
    generator.next();
    if (failures++ > 0) throw new Error("again");
  } catch {
    return generator;
  }
  return null;
}
const returned = () =>
  driveAndReturn(function* () {
    yield 1;
    yield 2;
  });
for (let i = 0; i < 3; i++) {
  const generator = returned();
  console.log(generator && look(generator), generator?.next().value);
}

let kept;
let steps = 0;
function driveAndKeep(generatorFunction) {
  let generator;
  try {
    generator = generatorFunction.apply(null, []);
    for (;;) {
      const result = generator.next();
      if (result.done) return result.value;
      if (steps++ > 1) throw new Error("late");
    }
  } catch (error) {
    kept = generator;
    return error.message;
  } finally {
    steps += 10;
  }
}
const stepped = () =>
  driveAndKeep(function* () {
    yield 1;
    yield 2;
    yield 3;
    return 4;
  });
console.log(stepped(), look(kept), kept.next().value);
console.log(stepped(), look(kept), kept.next().value);

let calls = 0;
function driveAndExtend(generatorFunction) {
  let generator;
  try {
    generator = generatorFunction.apply(null, []);
    generator.next();
    if (calls++ === 0) throw new Error("first");
    return generator.next().value;
  } catch {
    const prototype = Object.getPrototypeOf(generator);
    prototype.extended = 7;
    return prototype;
  }
}
const extended = () =>
  driveAndExtend(function* () {
    yield 1;
    yield 2;
  });
console.log(extended().extended, extended(), (function* () {})().extended);
