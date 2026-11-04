class K {
  constructor() {
    this.id = 1;
  }
}
const O1 = { id: 1 },
  O2 = { id: 1 },
  O1b = O1,
  A1 = [1],
  A2 = [1],
  K1 = new K();
let asks = 0;
const V1 = {
  valueOf() {
    asks++;
    return 1;
  },
}; // (it counts how often it is asked for its value: a test that is taken for decided, or asked twice, is seen)
const tags = new Map([
  [O1, "O1"],
  [O2, "O2"],
  [A1, "A1"],
  [A2, "A2"],
  [K1, "K1"],
  [V1, "V1"],
]);
const lines = [];
let T = [];
function show(v) {
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return String(v);
  if (tags.has(v)) return tags.get(v);
  if (Array.isArray(v))
    return (
      "[" +
      v
        .slice(0, 3)
        .map(x => (typeof x === "object" && x !== null && !tags.has(x) ? "obj" : show(x)))
        .join() +
      "]"
    );
  if (typeof v === "function") return "fn";
  if (v instanceof Number || v instanceof String || v instanceof Boolean || v instanceof BigInt)
    return "boxed " + show(v.valueOf());
  if ("id" in v)
    return "{id " + (typeof v.id === "object" && v.id !== null && !tags.has(v.id) ? "obj" : show(v.id)) + "}";
  return "obj";
}
function same(w) {
  return w;
}
function f(a, b, c) {
  let fuel = 12,
    dead = 0,
    deadT = 0;
  const box = { v: a },
    other = box;
  const g0 = () => {
    b = b + "";
  };
  if (a == b && a !== a) g0();
  a &&= b;
  if (c > b) {
    if ([c].indexOf(a) === 0) {
      T.push(typeof c === typeof b);
    } else {
      while (Array.isArray(a) && fuel-- > 0) {
        T.push("@1", a, b, c, box.v);
        b -= a;
      }
      T.push("@2", a, b, c, box.v);
      if (a === b) {
        a--;
      }
      if (b === a) {
        box.v++;
      } else {
        c ^= 1;
      }
    }
    T.push("@3", a, b, c, box.v);
  }
  for (let i4 = 0; i4 < 1 && (c === a || b !== c) && typeof b === "function"; i4++) {
    if (a === c) {
      same(a);
      T.push(typeof a === "object");
      T.push(a === c);
    }
  }
  T.push("end", a, b, c, box.v, other.v);
  return "end";
}
function go(at, a, b, c) {
  T = [];
  asks = 0;
  let r;
  try {
    r = f(a, b, c);
  } catch (e) {
    r = "threw " + (e && e.name);
  }
  lines.push(at + " " + r + " " + T.map(show).join(" ") + " asks " + asks);
}
const J1 = JSON.parse("[2147483647,-2147483648,2]");
const L2 = [1e21, 2, 1e21];
const L3 = [0n, -0.5, undefined];
for (let round = 0; round < 1; round++) {
  go(0, undefined, undefined, undefined);
  go(1, J1[0], J1[1], J1[2]);
  go(2, L2[0], L2[1], L2[2]);
  go(3, L3[0], L3[1], L3[2]);
}
console.log(lines.join("\n"));
