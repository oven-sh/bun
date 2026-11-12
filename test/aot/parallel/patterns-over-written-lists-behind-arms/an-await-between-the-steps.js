const unseen = (x) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
async function take(at, later, tools) {
  const [a = await later, b, c] = [undefined, tools.round(at + 0.5), at + 1];
  return a + ":" + b + ":" + c;
}
async function plainly(at, later) {
  const [a = await later, b, c] = [undefined, at + 0.5, at + 1];
  return a + ":" + b + ":" + c;
}
const all = await Promise.all([take(1, Promise.resolve("x"), kit), take(2, new Promise((done) => setTimeout(() => done("y"), 5)), kit), plainly(3, new Promise((done) => setTimeout(() => done("z"), 5)))]);
console.log(all.join(" "));
