const closureCount = 300;
const makeGenerator = base => function* () { yield base };
const makeAsyncGenerator = base => async function* () { yield base };

function createInTurn(make) {
  const closures = [], objects = [];
  for (let i = 0; i < closureCount; i++) {
    const closure = make(i);
    closures.push(closure);
    objects.push(closure());
    if (i % 50 === 49) Bun.gc(true);
  }
  return { closures, objects };
}

function countMismatches({ closures, objects }) {
  let mismatches = 0;
  for (let i = 0; i < closureCount; i++) {
    const closure = closures[i], other = closures[(i + 1) % closureCount];
    if (Object.getPrototypeOf(objects[i]) !== closure.prototype) mismatches++;
    if (!(objects[i] instanceof closure)) mismatches++;
    if (objects[i] instanceof other) mismatches++;
    if (objects[(i + 1) % closureCount] instanceof closure) mismatches++;
  }
  return mismatches;
}

const generators = createInTurn(makeGenerator);
console.log("first objects:", countMismatches(generators));
console.log("distinct prototypes:", new Set(generators.closures.map(closure => closure.prototype)).size);
console.log("values:", generators.objects.reduce((sum, object) => sum + object.next().value, 0));

Bun.gc(true);
const secondObjects = generators.closures.map(closure => closure());
console.log("second objects:", countMismatches({ closures: generators.closures, objects: secondObjects }));

generators.closures.forEach((closure, i) => { closure.prototype.tag = i });
Bun.gc(true);
console.log("own tags:", generators.closures.every((closure, i) => closure().tag === i));

const asyncGenerators = createInTurn(makeAsyncGenerator);
console.log("async objects:", countMismatches(asyncGenerators));
console.log("async value:", (await asyncGenerators.objects[closureCount - 1].next()).value);

function* topLevel() { yield "top" }
const generatorPrototype = Object.getPrototypeOf(topLevel.prototype);
const original = topLevel.prototype;
const before = [topLevel(), topLevel(), topLevel()];
console.log("before replacement:", before.every(object => Object.getPrototypeOf(object) === original));

const replacement = Object.create(generatorPrototype);
replacement.label = "replacement";
topLevel.prototype = replacement;
const replaced = topLevel();
console.log("replaced prototype:", Object.getPrototypeOf(replaced) === replacement, replaced.label, replaced.next().value);
console.log("instanceof after replacement:", replaced instanceof topLevel, before[0] instanceof topLevel);
console.log("earlier object:", Object.getPrototypeOf(before[0]) === original, before[0].label, before[0].next().value);
console.log("spread under replacement:", [...topLevel()].join());

topLevel.prototype = 1;
const fallback = topLevel();
console.log("primitive prototype:", Object.getPrototypeOf(fallback) === generatorPrototype, fallback.next().value);

topLevel.prototype = original;
const restored = topLevel();
console.log("restored prototype:", Object.getPrototypeOf(restored) === original, restored instanceof topLevel, replaced instanceof topLevel);
Bun.gc(true);
console.log("after collection:", Object.getPrototypeOf(topLevel()) === original);
