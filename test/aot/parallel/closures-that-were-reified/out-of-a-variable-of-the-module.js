const onRead = (self, box) => { box.last = self; return 5; };
let current = undefined;
function choose(turn) { current = turn % 50 === 49 ? undefined : onRead; }
function run(box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const handler = current;
  const got = handler(handler, box);
  return got + work;
}
const first = { last: undefined, tag: 1 };
const second = { last: undefined, tag: 2 };
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  choose(turn);
  try { total += run(turn & 1 ? first : second); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed);
choose(0);
console.log(Object.getOwnPropertyNames(onRead).length, run(first), typeof first.last);
