// A captured variable holds a closure or a number. On some turns the closure is given a member, and then it is called in two loops that follow each other: it is still the function it was.
const one = Date.now() > 0 ? 1 : 2;
function make() {
  const o = { k: one, m: a => o.k + a };
  return o.m;
}
function use(turn, count) {
  let v = make();
  const read = () => {
    let r = 0;
    for (let i = 0; i < count; i++) r += v(i);
    for (let i = 0; i < count; i++) r -= v(i * 2);
    return r;
  };
  if (turn % 2) v.tag = turn;
  if (turn % 20 === 7) v = 2.5;
  return read;
}
for (let turn = 0; turn < 9; turn++) {
  try {
    console.log(use(turn, 3 + (one - 1))());
  } catch (error) {
    console.log(error.name);
  }
}
