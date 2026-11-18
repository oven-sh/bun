// What is moved out of loops.

const holders = () => [
  [{ x: 1 }, 3], [{ x: 1.5 }, 3], [{ y: 1, x: 2 }, 3], [{ x: "s" }, 2], [{}, 3], [undefined, 0], [null, 1], [7, 2],
  [{ x: 1 }, 0], [[1, 2], 2], ["text", 2],
];

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.x;
  return sum;
}, holders);

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < 4; i++) if (i < n) sum += o.x;
  return sum;
}, holders);

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) if (typeof o === "object" && o !== null) sum += o.x;
  return sum;
}, holders);

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) sum += o.x * 2;
  return sum;
}, holders);

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += o.x;
    o.x = i;
  }
  return sum;
}, holders);

check(function (o, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) o.added = 5;
    seen[i] = o.added;
  }
  return seen;
}, holders);

check(function (o, n) {
  function Box(x) {
    this.x = x;
  }
  let last = new Box(o), sum = 0;
  const first = last;
  for (let i = 0; i < n; i++) {
    last.x = i + 1;
    sum += first.x;
    last = new Box(i);
  }
  return sum;
}, holders);

check(function (o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const made = { x: i };
    made.more = o.x;
    sum += made.more + made.x;
  }
  return sum;
}, holders);

const sparse = () => {
  const array = [1];
  array[1e8] = 2;
  return array;
};
const lists = () => [
  [[1, 2, 3], 1], [[1, 2, 3], 3], [[1.5, 2.5], 0], [[1, , 3], 1], [["a", "b"], 1], [[], 0], [[1, 2, 3], -1],
  [sparse(), 5e7], ["abc", 1], ["ab" + String(Math.min(1, 2)), 2], [new Uint8Array(4), 2], [{ length: 2, 1: 5 }, 1],
  [[1, 2, 3], 1.5], [undefined, 0],
];

check(function (a, k) {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += a[k];
  return sum;
}, lists);

check(function (a, k) {
  let sum = a.length;
  for (let i = 0; i < 3; i++) if (typeof a === "object" && i > 1) sum += a[k];
  return sum;
}, lists);

check(function (a, k) {
  let sum = 0;
  for (let i = 0; i < a.length && i < 5; i++) sum += a[i];
  return sum;
}, lists);

check(function (a, k) {
  let sum = 0;
  for (let i = 0; i < a.length && i < 5; i++) {
    sum += a[i];
    if (i === k) a.length = 1;
  }
  return sum;
}, lists);

check(function (a, k) {
  let sum = 0;
  for (let i = Math.min(a.length, 5) - 1; i >= 0; i--) sum += a[i] + a[i + 1 - 1];
  return sum;
}, lists);

check(function (a, k) {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    a[3] = i;
    sum += a[3] + a[k];
  }
  return sum;
}, lists);

check(function (a, k) {
  const rows = [a, a];
  let sum = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) sum += rows[i][k];
  return sum;
}, lists);

check(function (a, b) {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += a * b + (a | 0) / b;
  return sum;
}, pairs);

check(function (a, b) {
  let sum = 0;
  for (let i = 0; i < 3; i++) if (b) sum += (a % b) + -a;
  return sum;
}, pairs);

check(function (a) {
  const made = { x: 1 };
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += made.x;
    made.x = a;
  }
  return sum;
}, singles);

const twins = () => {
  const make = () => ({ x: 1 });
  const only = make();
  return [[make(), make()], [only, only]];
};

check(function (o, p) {
  let sum = o.x;
  for (let i = 0; i < 3; i++) {
    sum += o.y === undefined ? 0 : 10;
    if (i === 0) p.y = 1;
  }
  return sum;
}, twins);

check(
  function (arrays, k) {
    let sum = 0;
    for (let turn = 0; turn < arrays.length; turn++) {
      const a = arrays[turn], marks = [{}, {}];
      sum += a.length;
      if (turn === 0) continue;
      for (let i = 0; i < 2; i++) {
        marks[i].seen = true;
        sum += a[k];
      }
    }
    return sum;
  },
  () => [[[[1.5], [1, 2]], 1], [[[1.5], sparse()], 9e7]],
);

check(
  function (rows, columns) {
    const cells = [1, 2, 3, 4];
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < rows; j++) {
        const width = j === 1 ? 0 : columns;
        for (let i = 0; i < width; i++) sum += cells[i & 3] * j + k;
      }
      cells[k] = k === 1 ? 0.5 : sum;
    }
    return sum;
  },
  () => [[3, 300], [0, 5], [2, 0], [4, 1.5], [200, 2]],
);

check(
  function (which, turns) {
    const nested = a => b => c => () => a.x + b++ + c++;
    const targets = [nested({ x: 1 })(2)(3), nested({ x: 2 })(3)(4), Math.random() < 2 ? parseInt : 0, () => 1];
    const run = (f, n) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += f() || 0;
      return sum;
    };
    return [run(targets[0], 2), run(targets[3], 2), run(targets[which], turns)];
  },
  () => [[0, 3], [1, 3], [2, 3], [3, 3], [3, 0]],
);

check(
  function (when) {
    class Holder {
      constructor() {
        this.a = { v: 1 };
      }
    }
    const holder = new Holder();
    let calls = 0, sum = 0;
    const change = Function("holder", "now", "if (now) delete holder.a;");
    for (let k = 0; k < 4; k++) {
      let i = 0;
      change(holder, ++calls === when);
      do sum += holder.a.v;
      while (++i < 60);
    }
    return sum;
  },
  () => [[9], [3]],
);
globalThis.same = new Function("a", "b", "with (a) return a === b;");
checkInTurn(
  all => {
    const found = [];
    found.tag = 1;
    for (let i = 0; i < all.length; i++) {
      let has = false;
      for (let j = 0; j < found.length; j++) if (same(all[i], found[j])) { has = true; break; }
      if (!has) found.push(all[i]);
    }
    return found.length;
  },
  () => [[Array.from({ length: 60 }, (_, i) => "s" + i)], [Array.from({ length: 60 }, (_, i) => "s" + (i & 3))]], 3,
);
globalThis.never = {};
checkInTurn(n => { let calls = 0; outer: for (let i = 0; i < n; i++) { let j = 0; while (++j < 12) if (never === 0) continue outer; calls += same("a", "a"); } return calls; }, () => [[5], [9]], 6);
