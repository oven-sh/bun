const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function* take(at, tools) {
  const [a = yield "first", b, c] = [undefined, tools.round(at + 0.5), at + 1];
  return a + ":" + b + ":" + c;
}
const steps = take(1, kit);
const one = steps.next();
const junk = [];
for (let i = 0; i < 1000; i++) junk.push({ i });
const two = steps.next("sent");
console.log(one.value, two.value, junk.length);
