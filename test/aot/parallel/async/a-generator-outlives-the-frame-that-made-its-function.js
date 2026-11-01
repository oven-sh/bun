// The function object never leaves the function that makes it: it is only called there. Its generator does leave, and finds the function again when somebody asks what the generator inherits from,
// long after the frame of the maker is gone.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
function start(tag) {
  const f = function* () {
    const sent = yield tag + 1;
    return sent;
  };
  return f();
}
function startTwo(tag) {
  const f = function* () {
    yield tag;
  };
  return [f(), f()];
}
function churn(depth, a, b, c) {
  const list = [a, b, c, depth];
  return depth ? churn(depth - 1, b + 1, c + 2, a + 3) + list.length : hide(list).length;
}
const out = [];
const kept = [];
for (let round = 0; round < 200; round++) {
  kept.push(hide(start("a" + round)));
  const [one, two] = startTwo("b" + round);
  kept.push(hide(one), hide(two));
}
churn(300, 1, 2, 3);
if (typeof Bun !== "undefined") Bun.gc(true);
churn(300, 4, 5, 6);
let good = 0;
for (let index = 0; index < kept.length; index += 3) {
  const [g, one, two] = kept.slice(index, index + 3);
  const prototype = Object.getPrototypeOf(g);
  good +=
    Object.getPrototypeOf(prototype) === generatorPrototype &&
    prototype === Object.getPrototypeOf(g) &&
    Object.getPrototypeOf(one) === Object.getPrototypeOf(two) &&
    Object.getPrototypeOf(one) !== prototype &&
    Object.getOwnPropertyNames(prototype).length === 0 &&
    g.next().value === "a" + index / 3 + 1 &&
    two.next().value === "b" + index / 3
      ? 1
      : 0;
}
out.push(good + " of " + kept.length / 3);
Object.getPrototypeOf(kept[0]).extra = "added";
out.push([kept[0].extra, kept[3].extra, kept[1].extra].join());
console.log(out.join("\n"));
