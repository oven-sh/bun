// `p5 = undefined` lets go of what the parameter held, and the word of the generator's frame that held it is cleared there and then. The sum `e` lives on across that statement, and the next yields
// find it in its own word of the frame, where the yield before left it: that word stays as it is.
let order = 0;
let said = "";
function fold(value) {}
function* count(from, steps) {
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    yield from + i;
    sum = (sum + from + i) | 0;
  }
  return sum;
}
function* k4(x, y, z, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10) {
  let a = x,
    b = y,
    c = z,
    d = 2147483647,
    e = 5,
    f = -2147483648;
  for (let i0 = 0; i0 < 4; i0++) {
    e = (e >>> 1) + (yield* count(3, 3));
    {
      const before = c;
      yield e;
      c = c + before;
    }
    p5 = undefined;
    for (let i1 = 0; i1 < (y & 3); i1++) {
      yield (a - d) | 0;
    }
    try {
      yield b;
      c = c & c;
      yield c;
    } finally {
      order = (Math.imul(order, 31) + b) | 0;
    }
  }
}
function use4(x, y, z) {
  const first = k4(x, y, z, { id: 0 }, [0], { id: 9 }, "t7", { id: 2 }, [3], 0, "t1", { id: 9 }, { id: 9 }, [0]),
    second = k4(z, x, y, { id: 0 }, [0], { id: 9 }, "t7", { id: 2 }, [3], 0, "t1", { id: 9 }, { id: 9 }, [0]);
  let total = 0,
    sent = 1;
  for (let step = 0; step < 60; step++) {
    const r = first.next(sent),
      s = second.next(total & 7);
    if (r.done || s.done) return total + "=" + r.value + "," + s.value;
  }
}
console.log(
  "k4",
  [use4(65535, 1073741824, 7), use4(-0.5, 1, 2147483646), use4(-7, -2147483648, -2), use4(256, 6, 2147483647)].join(
    " ",
  ),
  order,
  said,
);
