const show = v =>
  typeof v === "number"
    ? Object.is(v, -0)
      ? "-0"
      : String(v)
    : typeof v === "bigint"
      ? v + "n"
      : typeof v === "string"
        ? JSON.stringify(v)
        : String(v);
const LENGTHS = [0, 1, 2, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 32, 33, 64, 65, 1000];
const STARTS = [
  -1,
  0,
  1,
  -5,
  -0,
  0.5,
  NaN,
  Infinity,
  -Infinity,
  2147483639,
  2147483647,
  -2147483640,
  4294967287,
  9007199254740983,
  9007199254740991,
  100,
];
const STEPS = [1, 2, -1, 3, 0.5, NaN, -0, 2147483647, 1e15, 7, 0, -2147483648];
const PLACES = [-1, 0, 3, 7, 8, 9, 11, 12, 15, 16, 20, 500];
const STEP = 3;
function value(pattern, i) {
  switch (pattern) {
    case 0:
      return 0;
    case 1:
      return i % 97;
    case 2:
      return 96 - (i % 97);
    case 3:
      return (i * 37 + 11) % 97;
    case 4:
      return 5;
    default:
      return ((i * 53 + 29) % 97) - 48;
  }
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return "threw " + error.name;
  }
}
function make_ints(n, pattern, place) {
  const v = [];
  for (let i = 0; i < n; i++) v.push(i === place ? 99 : value(pattern, i));
  return v;
}
function f1(v, start, c, b, o) {
  let k = 9007199254740983,
    j = start | 0,
    s = 2147483600,
    g = -Infinity,
    other = start,
    last = start;
  let t = 0,
    m = 0,
    n2 = 0,
    fin = 0,
    idx = -1,
    once = true,
    thrown = "";
  const seen = [],
    out = [0, 0, 0, 0, 0, 0, 0, 0];
  const bump = () => {
    k += 1;
  };
  {
    let i = 0;
    if (v.length > 0)
      do {
        const x = v[i];
        i++;
        idx++;
        bump();
        s += STEP;
        for (let q = 0; q < 3; q++) {
          t += k;
          m++;
        }
        if (idx === b) break;
      } while (i < v.length);
  }
  return (
    [k, j, s, g, other, last, t, m, n2, fin, thrown].map(show).join() +
    "|" +
    seen.map(show).join() +
    "|" +
    out.map(show).join()
  );
}
const lines = [];
for (let a = 0; a < LENGTHS.length; a++)
  for (let z = 0; z < STARTS.length; z++) {
    const n = LENGTHS[a],
      start = STARTS[z];
    {
      const place = PLACES[(a * 5 + z * 3 + 1) % PLACES.length],
        c = STEPS[(a + z * 7 + 1) % STEPS.length],
        pattern = (a + z + 1) % 6,
        o = {
          f: STEPS[(a * 3 + z + 1) % STEPS.length],
          get g() {
            return 2;
          },
        };
      lines.push(
        "a list, do while | " +
          n +
          " " +
          show(start) +
          " " +
          place +
          " " +
          show(c) +
          " " +
          show(o.f) +
          " " +
          pattern +
          ": " +
          attempt(() => f1(make_ints(n, pattern, place), start, c, place, o)),
      );
    }
  }
console.log(lines.join("\n"));
