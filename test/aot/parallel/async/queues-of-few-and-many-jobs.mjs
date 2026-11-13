// Awaits in jobs while the queue holds no job, a few, sixteen, seventeen and thousands; in and outside of loops, with jobs that end, throw, start others and wait for each other.
const out = [];
const later = value => new Promise(resolve => queueMicrotask(() => resolve(value)));
const fails = value => new Promise((_, reject) => queueMicrotask(() => reject(value)));
async function leaf(value) {
  await later(value);
  return value;
}
async function straight(seed) {
  const held = { seed }, text = "s" + seed, half = seed / 2;
  const a = await later(seed);
  const b = await leaf(a + 1);
  const c = await leaf(b + half);
  return [held.seed, text, c].join(":");
}
async function looping(seed, turns) {
  let sum = 0.5, list = [];
  for (let turn = 0; turn < turns; turn++) {
    sum += await later(turn);
    list.push(await leaf(seed + turn));
    if (turn % 3 === 2) {
      try {
        await fails(seed);
      } catch (error) {
        sum += error;
      } finally {
        sum += await later(1);
      }
    }
  }
  return sum + list.join("");
}
async function failing(seed) {
  await later(seed);
  await leaf(seed);
  throw new Error("failed " + seed);
}
async function starting(depth) {
  await later(depth);
  if (!depth) return 1;
  const both = [starting(depth - 1), starting(depth - 1)];
  return (await both[0]) + (await both[1]);
}
async function* stream(seed) {
  for (let index = 0; index < 3; index++) yield await leaf(seed + index);
}
async function reads(seed) {
  let sum = 0;
  for await (const value of stream(seed)) sum += value;
  return sum;
}
function hash(values) {
  let word = 7;
  for (const value of values) for (const character of String(value)) word = (word * 31 + character.charCodeAt(0)) | 0;
  return word;
}
for (const count of [1, 2, 3, 7, 8, 15, 16, 17, 18, 31, 33, 64, 500, 3000]) {
  const jobs = [];
  for (let index = 0; index < count; index++) jobs.push(straight(index), looping(index, (index % 4) + 1), failing(index).catch(error => error.message), reads(index));
  const order = [];
  jobs.forEach((job, index) => job.then(() => order.push(index)));
  const values = await Promise.all(jobs);
  await later(0);
  out.push([count, values.length, hash(values), hash(order), order.length].join(" "));
}
out.push(await starting(9));
let ring = Promise.resolve(0);
for (let index = 0; index < 200; index++) ring = (async before => (await before) + (await leaf(index)))(ring);
out.push(await ring);
const held = Array.from({ length: 40 }, (_, index) => looping(index, 5));
out.push(hash(await Promise.all(held)), (await Promise.allSettled([...held.slice(0, 20), failing(1)])).map(entry => entry.status[0]).join(""));
console.log(out.join("\n"));
setTimeout(async () => console.log(await looping(3, 4), await straight(9)), 0);
