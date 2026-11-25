function onRead(self, box) { box.last = self; return 5; }
function run(handler, box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = handler(handler, box);
  return got + work;
}
const first = { last: undefined, tag: 1 };
const second = { last: undefined, tag: 2 };
let total = 0, missed = 0;
for (let turn = 0; turn < 300; turn++) {
  try { total += run(turn % 50 === 49 ? undefined : onRead, turn & 1 ? first : second); }
  catch (error) { missed += error.name === "TypeError" ? 1 : 100; }
}
console.log(total, missed);
console.log(Reflect.ownKeys(onRead).length);
console.log(run(onRead, first), typeof first.last);
