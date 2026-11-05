// An object is adopted through `then` exactly while it has one, also where `then` comes and goes among properties under computed keys, after objects with the same other properties were awaited and returned many times.
const log = [];
const named = (...parts) => parts.join("");

function makePoint(x) {
  return { x, y: 2 };
}
function adopt(label) {
  return function (resolve) {
    log.push(`then of ${label} ${this.x}`);
    resolve(`adopted from ${label}`);
  };
}
async function returns(value) {
  return value;
}
async function awaits(value) {
  return await value;
}
function describe(value) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
async function observe(label, value) {
  log.push(`${label}: returned ${describe(await returns(value))}`);
  log.push(`${label}: awaited ${describe(await awaits(value))}`);
  log.push(`${label}: resolved ${describe(await Promise.resolve(value))}`);
  log.push(`${label}: in all ${describe((await Promise.all([value]))[0])}`);
}

const tagged = makePoint(1);
tagged[named("t", "ag")] = "first";
const emptied = makePoint(2);
emptied[named("t", "ag")] = "gone";
delete emptied[named("t", "ag")];
let sum = 0;
for (let i = 0; i < 200; i++) sum += (await returns(tagged)).x + (await awaits(tagged)).y + (await returns(emptied)).x + (await awaits(emptied)).y;
log.push(`warm ${sum}`);
await observe("tagged", tagged);
await observe("emptied", emptied);

const sibling = makePoint(3);
sibling[named("t", "ag")] = "second";
await observe("sibling", sibling);
sibling[named("th", "en")] = adopt("sibling");
await observe("sibling with then", sibling);
await observe("tagged beside it", tagged);

tagged[named("th", "en")] = adopt("tagged");
await observe("tagged with then", tagged);
delete tagged[named("th", "en")];
await observe("tagged without then", tagged);
tagged[named("th", "en")] = 5;
await observe("tagged with a number", tagged);

emptied[named("th", "en")] = adopt("emptied");
await observe("emptied with then", emptied);
delete emptied[named("th", "en")];
await observe("emptied again", emptied);

const many = [];
for (let i = 0; i < 40; i++) {
  const point = makePoint(10 + i);
  point[named("t", "ag")] = i;
  if (i % 4 === 3) point[named("th", "en")] = adopt("every fourth");
  many.push(point);
}
for (const point of many) log.push(describe(await returns(point)));

const inheriting = makePoint(4);
inheriting[named("t", "ag")] = "third";
await observe("inheriting", inheriting);
Object.setPrototypeOf(inheriting, { then: adopt("the prototype") });
await observe("inheriting a then", inheriting);

console.log(log.join("\n"));
