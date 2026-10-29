// An async function makes a generator function in front of an await and another behind it. Whatever the compiled code keeps in its frame over the await to make the second one
// is no reference, whatever it looks like, and the collector runs while the function waits, with a hundred megabytes of dead cells around.
let open;
const gate = new Promise(resolve => { open = resolve; });
async function twice(a, b) {
  const first = function* () { yield a; yield a + 1; };
  let sum = 0;
  for (const n of first()) sum += n;
  await gate;
  const second = function* () { yield b; yield b + 1; };
  for (const n of second()) sum += n;
  return sum + " " + typeof second + " " + Object.getPrototypeOf(second).constructor.name + " " + (second.prototype !== first.prototype);
}
function makeGarbage(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push({ i, twice: i * 2, text: null });
  return list.length;
}
console.log(makeGarbage(3_000_000));
const waiting = twice(1, 10);
Bun.gc(true);
open();
console.log(await waiting);
