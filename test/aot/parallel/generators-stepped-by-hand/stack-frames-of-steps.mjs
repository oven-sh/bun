// The frames of an error that a generator's body throws name the line of the step that ran it, in loops and in functions that loops call.
function fail(at) { throw new Error(at); }
function* first(v) { if (v === 0) fail("first"); yield v; }
function* second(v) { yield v; if (v === 1) fail("second"); yield v; }
function* third(v) { yield v; yield v; if (v === 2) fail("third"); }
function* looped(v) { for (let k = 0; k < 3; k++) { yield k; if (k === v) fail("looped"); } fail("behind"); }
const frames = error => error.stack.split("\n").slice(1, 5).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).filter(line => !/next \(|\bnext$/.test(line)).join(" | ");
const makers = [first, second, third];
function three(v) {
  const it = third(v);
  const a = it.next();
  const b = it.next(a.value);
  const c = it.next(b.value);
  return c;
}
function two(v) {
  const it = second(v);
  it.next();
  return it.next().value;
}
function one(v) {
  const it = first(v);
  return it.next().value;
}
function ofLooped(v) {
  const it = looped(v);
  it.next();
  it.next();
  it.next();
  return it.next().value;
}
for (let turn = 0; turn < 3; turn++) {
  for (const f of [one, two, three, ofLooped]) {
    for (let v = 0; v < 4; v++) {
      try {
        f(v);
        console.log(f.name, v, "fine");
      } catch (error) {
        console.log(f.name, v, error.message, frames(error).split(" | ").slice(0, 3).join(" | "));
      }
    }
  }
  for (let v = 0; v < 4; v++) {
    try {
      const it = second(v);
      const a = it.next();
      console.log(a.value,
        it.next().value);
      const other = third(v);
      other.next();
      other.next();
      console.log(
        other.next().done);
    } catch (error) {
      console.log(v, error.message, frames(error).split(" | ").slice(0, 2).join(" | "));
    }
  }
}
