// The loops stand in the module's own code. Each closure over `i` is made by a closure over `i`, and is called as soon as it is made.
const makers = [];
for (let i = 0; i < 3; i++) makers.push(() => () => i);

const byLoop = []; for (const make of makers) byLoop.push(make()() + 1);
console.log(JSON.stringify(byLoop));

const withoutSum = []; for (const make of makers) withoutSum.push(make()());
console.log(JSON.stringify(withoutSum));

const throughAConst = []; for (const make of makers) { const read = make(); throughAConst.push(read() + 1); }
console.log(JSON.stringify(throughAConst));

const byIndex = []; for (let k = 0; k < makers.length; k++) byIndex.push(makers[k]()() + 1);
console.log(JSON.stringify(byIndex));

const oneDeep = [];
for (let i = 0; i < 3; i++) oneDeep.push(() => i);
const fromOneDeep = []; for (const read of oneDeep) fromOneDeep.push(read() + 1);
console.log(JSON.stringify(fromOneDeep));

const ofAList = [];
for (const i of [0, 1, 2]) ofAList.push(() => () => i);
const fromAList = []; for (const make of ofAList) fromAList.push(make()() + 1);
console.log(JSON.stringify(fromAList));

const mapped = [0, 1, 2].map(i => () => () => i);
const fromMapped = []; for (const make of mapped) fromMapped.push(make()() + 1);
console.log(JSON.stringify(fromMapped));

const ofTexts = [];
for (let i = 0; i < 3; i++) { const text = "t" + i; ofTexts.push(() => () => text); }
const fromTexts = []; for (const make of ofTexts) fromTexts.push(make()() + "!");
console.log(JSON.stringify(fromTexts));

const ofObjects = [];
for (let i = 0; i < 3; i++) { const object = { i }; ofObjects.push(() => () => object); }
const fromObjects = []; for (const make of ofObjects) fromObjects.push(make()().i + 1);
console.log(JSON.stringify(fromObjects));

function inAFunction(count) {
  const made = [];
  for (let i = 0; i < count; i++) made.push(() => () => i);
  const read = []; for (const make of made) read.push(make()() + 1);
  return read;
}
console.log(JSON.stringify([inAFunction(3), inAFunction(5)]));
