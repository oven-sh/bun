// Math.PI, Number.MAX_VALUE and their like, read where they stand, off names for Math and Number, shadowed, written to, deleted, called; parseInt and parseFloat of what may be an integer.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : String(v));
const lines = [];
const list = JSON.parse("[3, 1.5, -7, 0, 250, 1e21, 5e-7, -0.0000004, 2147483648, -2147483649]");
function least(values) {
  let best = Number.MAX_VALUE;
  for (let i = 0; i < values.length; i++) if (values[i] < best) best = values[i];
  return best;
}
function turn(angle) {
  if (angle > Math.PI * 2) angle -= Math.PI * 2;
  if (angle < -Number.EPSILON) angle += 2 * Math.PI;
  return angle;
}
function scale(values) {
  let s = 0;
  for (let i = 0; i < values.length; i++) s = s * 0.5 + values[i] * Math.SQRT2 + values[i] / Math.LN10;
  return s;
}
function isSafe(x) {
  return x <= Number.MAX_SAFE_INTEGER && x >= Number.MIN_SAFE_INTEGER;
}
lines.push(show(least(list)), show(turn(9)), show(turn(-1)), show(scale(list)), list.map(isSafe).join());
lines.push([Math.E, Math.LN2, Math.LOG2E, Math.LOG10E, Math.SQRT1_2, Number.MIN_VALUE, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, Infinity, -Infinity, NaN, undefined].map(show).join());
const M = Math, { PI, E: e } = Math, N = [Number, { MAX_VALUE: 3 }];
lines.push(show(M.PI), show(PI + e), show(N[0].MAX_VALUE), show(N[1].MAX_VALUE), show(Math["PI"]), show(Math?.PI), show((0, Math).PI));
function shadowed(Math, Number) {
  return Math.PI + Number.MAX_VALUE;
}
lines.push(show(shadowed({ PI: 1 }, { MAX_VALUE: 2 })));
(function () {
  let calls = 0;
  const Math = {
    get PI() {
      return ++calls;
    },
  };
  lines.push(show(Math.PI + Math.PI));
})();
function refused(act) {
  try {
    return show(act());
  } catch (error) {
    return error.constructor.name;
  }
}
lines.push(
  refused(() => Math.PI()),
  refused(() => new Number.MAX_VALUE()),
  refused(() => Math.PI.x.y),
  refused(() => Math.PI.toFixed(2)),
  refused(() => typeof Math.PI + typeof Number.NaN),
  refused(() => ((Math.PI = 3), Math.PI)),
  refused(() => delete Math.PI),
  refused(() => Math.PI++),
  refused(() => `${Math.PI}${Number.EPSILON}`),
  refused(() => [Math.PI].includes(3.141592653589793)),
  refused(() => Math.PI in { 3.141592653589793: 1 }),
  refused(() => ({ [Math.PI]: Math.PI })[Math.PI]),
);
switch (3.141592653589793) {
  case Math.PI:
    lines.push("pi");
    break;
  default:
    lines.push("other");
}
const things = [3, "3", -0, 0, 1.5, "1.5", "0x1f", " 42px", NaN, Infinity, null, undefined, true, "", {}, [7], 2147483648, -2147483648, 1e21, 5e-7, 10n, { toString: () => "12" }, "-0", new Number(5)];
function whole(x) {
  return parseInt(x);
}
function decimal(x) {
  return parseInt(x, 10);
}
function hex(x) {
  return parseInt(x, 16);
}
function float(x) {
  return parseFloat(x);
}
function field(o) {
  return Number.parseInt(o.n) + 1;
}
for (let round = 0; round < 3; round++) {
  const t = [];
  for (let i = 0; i < things.length; i++) t.push(show(whole(things[i])), show(decimal(things[i])), show(hex(things[i])), show(float(things[i])));
  lines.push(t.join());
}
lines.push(show(field({ n: 4 })), show(field({ n: -0 })), show(field({ n: undefined })), show(field({})), show(field({ n: 5.7 })));
lines.push(refused(() => whole(Symbol("s"))), refused(() => float(Object.create(null))));
let total = 0;
for (let i = 0; i < 100; i++) total += whole(i) + decimal(i / 3) + parseInt(list[i % 10]);
lines.push(show(total));
console.log(lines.join("\n"));
