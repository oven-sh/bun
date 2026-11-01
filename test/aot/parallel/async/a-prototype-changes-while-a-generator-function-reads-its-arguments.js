// The first change to the prototype object of a generator function comes while another generator function reads its arguments: its generator may be there already, and has no frame yet.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6));
function make(tag) {
  return hide(function* () {
    const sent = yield tag + 1;
    return sent;
  });
}
const out = [];
const other = make("a");
const kept = hide(other());
let changes = 0;
function change() {
  other.prototype["extra" + changes] = changes;
  return changes++;
}
function makeReader(tag) {
  return hide(function* (first = change(), { second } = { second: change() }) {
    yield tag + first + second;
    return first;
  });
}
for (let round = 0; round < 4; round++) {
  const f = makeReader("r" + round);
  const g = hide(f());
  const h = hide(f(7));
  out.push([kept["extra" + (changes - 1)], g.next().value, h.next().value, Object.getPrototypeOf(g) === f.prototype, Object.getPrototypeOf(h) === f.prototype, g instanceof f, g.extra0].join());
}
const thrower = hide(function* (first = (() => { change(); throw new RangeError("while reading"); })()) { yield first; });
try {
  thrower();
} catch (error) {
  out.push(error.message + " " + kept["extra" + (changes - 1)]);
}
out.push(String(Object.getPrototypeOf(hide(thrower(1))) === thrower.prototype));
console.log(out.join("\n"));
