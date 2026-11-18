// Exits go back as far as nothing has happened that cannot be done again.

check(
  function (a, b) {
    function Point(x, y) {
      this.x = x ? x : 0;
      this.n = 0;
      this.n++;
      this.y = y + 1;
      this.n++;
    }
    const point = new Point(a, b);
    point.n += point.y * 2;
    return point;
  },
  pairs,
);

check(
  function (a, b) {
    const log = [];
    const made = { a, count: 0 };
    made.count++;
    log.push(made);
    made.count++;
    made.sum = a - b;
    made.count++;
    return log;
  },
  pairs,
);

check(
  function (a, b) {
    let calls = 0;
    const count = () => ++calls;
    const made = { first: 1 };
    if (a) made.second = count();
    else made.third = 3;
    made.first += b * 2;
    return [made, calls];
  },
  pairs,
);

check(
  function (a, b) {
    let made = { turns: 0 };
    for (let i = 0; i < 3; i++) {
      made.turns++;
      made.last = i === 2 ? a * b : i;
      if (i === 1) made = { turns: made.turns, last: 0 };
    }
    made.after = a - 1;
    return made;
  },
  pairs,
);

check(
  function (a, b) {
    const old = { value: 1 };
    const pick = (x, y) => (x ? y : old);
    const made = { value: 2 };
    const before = old.value;
    pick(a, made).value = 5;
    made.value += 1;
    return [before, old.value, made.value, b - 1];
  },
  pairs,
);

check(
  function (a, b) {
    const made = {};
    for (const name of ["p", "q"]) made[name] = 1;
    const wide = { a: 1 };
    wide.b = 2, wide.c = 3, wide.d = 4, wide.e = 5, wide.f = 6, wide.g = 7, wide.h = a * 2;
    wide.i = wide.h + b * 2;
    try {
      wide.j = 1;
      wide.j += b.x.y;
    } catch {
      wide.j++;
    }
    return [made, wide];
  },
  pairs,
);
check(a => { function K(x) { "use strict"; const o = {}; o.a = arguments[1] + 1; } return Object.getPrototypeOf(a ? new K(1, a) : new K()) === K.prototype; }, singles);
