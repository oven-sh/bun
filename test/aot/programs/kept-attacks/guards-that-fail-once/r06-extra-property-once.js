// Guards that fail once: extra property once. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 5000000);
const variant = process.argv[4] ?? "store";

function makePoint(x) {
  return { x, y: 2, z: 3 };
}
const point = makePoint(1);
if (trip) {
  const name = process.argv[2] + "x";
  point[name] = 1;
  delete point[name];
}

function stores(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    object.x = i & 7;
    object.y = i & 3;
    sum = (sum + object.x + object.y) | 0;
  }
  return sum;
}
function reads(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + object.x + object.z + i) | 0;
  return sum;
}
async function awaits(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await object).y) | 0;
  return sum;
}
async function answers(object) {
  return object;
}
async function awaitsAnswers(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + (await answers(object)).y) | 0;
  return sum;
}
function lists(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + Object.keys(object).length) | 0;
  return sum;
}
function writes(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + JSON.stringify(object).length) | 0;
  return sum;
}
function spreads(object) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + { ...object }.z) | 0;
  return sum;
}
const loops = { store: stores, read: reads, await: awaits, answer: awaitsAnswers, keys: lists, json: writes, spread: spreads };
Promise.resolve(loops[variant](point)).then(sum => console.log(variant, sum));
