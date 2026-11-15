const kept = [], values = [], places = new Map();
function keeps(job, value) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  kept.push(job);
  values.push(value);
  places.set(job, kept.length - 1);
  return job() - value + work;
}
function calls(job, value) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return job() - value + work;
}
const takers = [keeps, calls];
const choice = JSON.parse("[0,1,0]");
function inLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const t = i, u = i * 3, box = { n: i * 5 };
    const take = takers[choice[i % 3]];
    sum = (sum + take(() => t, t)) | 0;
    sum = (sum + take(() => t + box.n, t + box.n)) | 0;
    sum = (sum + take(() => t + u + box.n, t + u + box.n)) | 0;
  }
  return sum;
}
function once(take, t) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box = { n: t * 7 };
  const got = take(() => box.n, t * 7);
  return got + work;
}
function outOfLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + once(takers[choice[i % 3]], i)) | 0;
  return sum;
}
console.log(inLoop(60000), outOfLoop(60000));
let wrong = 0, misplaced = 0, same = 0;
for (let j = 0; j < kept.length; j++) {
  if (kept[j]() !== values[j]) wrong++;
  if (places.get(kept[j]) !== j) misplaced++;
  if (j && kept[j] === kept[j - 1]) same++;
}
console.log(kept.length, places.size, wrong, misplaced, same);
