// The same sums over fields that are strings, missing, getters, null, bigints, objects, -0 and NaN, over objects of several shapes.
const parse = value => JSON.parse(JSON.stringify(value));
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v));
function sums(points) {
  let a = 0,
    b = -0,
    c = 1,
    d = 0;
  for (const { x, y } of points) {
    a += x;
    b += y;
    c = x * y + c;
    d -= x - y;
    if (x > y) d += x * x;
  }
  return [a, b, c, d].map(show).join();
}
function indexed(points) {
  let a = 0,
    b = 0,
    c = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      x = p.x;
    a += x;
    b += x * x;
    c += x + "";
  }
  return [a, b, c].map(show).join();
}
const values = [1, 0.5, -0, NaN, "7", "", undefined, null, true, 5n, [], [3], { valueOf: () => 4 }, { toString: () => "t" }, Symbol.iterator, 2147483648];
for (const run of [sums, indexed]) {
  for (const value of values) {
    for (const at of [0, 3, 7]) {
      for (const key of ["x", "y"]) {
        const points = parse(Array.from({ length: 8 }, (_, i) => ({ x: i, y: i * 0.5 })));
        points[at][key] = value;
        try {
          console.log(run(points));
        } catch (error) {
          console.log(error.constructor.name);
        }
      }
    }
  }
  const changes = [l => (l[2] = null), l => (l[2] = 5), l => delete l[1].x, l => Object.defineProperty(l[3], "x", { get() { l[4] = { x: "late", y: 1 }; return 2; } }), l => (l[2] = Object.create({ x: 1, y: 2 })), l => (l[1] = { y: 1, z: 2, x: 3 }), l => (l[5] = [1, 2]), l => (l.length = 4), l => (l[6] = new Proxy({ x: 1, y: 2 }, {}))];
  for (const change of changes) {
    const points = parse(Array.from({ length: 8 }, (_, i) => ({ x: i, y: i * 0.5 })));
    change(points);
    try {
      console.log(run(points));
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
}
