// Makers store names on instances that their class does not declare: all of them store one name, some store more, and some objects get further names much later, with collections in between.
class Made {}
function first(i) {
  const made = new Made();
  made.a = i;
  made.b = "b" + i;
  return made;
}
function second(i) {
  const made = new Made();
  made.a = i;
  return made;
}
function deed(made, i) {
  Bun.gc(true);
  made.late = { i };
  made.b = "later" + i;
  Bun.gc(true);
  made.last = [i];
  return JSON.stringify(made) + Object.keys(made).join();
}
console.log(deed(first(1), 1), deed(second(2), 2));
const kept = [];
for (let i = 0; i < 40; i++) kept.push(i % 2 ? first(i) : second(i));
let last = "";
for (let i = 0; i < kept.length; i++) last = deed(kept[i], i);
console.log(last, JSON.stringify(kept[0]), JSON.stringify(kept[1]));
