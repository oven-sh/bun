// A product of int32s is -0 where one factor is 0 and the other is negative. Bit operators, comparisons and sums with integers do not show it.
const is = value => (Object.is(value, -0) ? "-0" : String(value));
function masked(a, b) {
  a |= 0;
  b |= 0;
  return (a * b) & 0xffff;
}
function shifted(a, b) {
  a |= 0;
  b |= 0;
  const m = a * b;
  return (m >> 14) + (m & 0x3fff);
}
function twoProducts(a, b, c, d) {
  a = a >> 14;
  b = b & 0x3fff;
  c = c >> 14;
  d = d & 0x3fff;
  const m = a * d + c * b;
  return ((m & 0x3fff) << 14) + (m >> 14) + a * c;
}
function besideInteger(a, b, c) {
  a |= 0;
  b |= 0;
  return (c | 0) + a * b;
}
function subtracted(a, b, c) {
  a |= 0;
  b |= 0;
  return (c | 0) - a * b;
}
function compared(a, b) {
  a |= 0;
  b |= 0;
  return [a * b < 1, a * b === 0, a * b >= 0, a * b == "0"].join();
}
function shown(a, b) {
  a |= 0;
  b |= 0;
  return a * b;
}
function sumShown(a, b, c, d) {
  a |= 0;
  b |= 0;
  c |= 0;
  d |= 0;
  return a * b + c * d;
}
function differenceShown(a, b, c, d) {
  a |= 0;
  b |= 0;
  c |= 0;
  d |= 0;
  return a * b - c * d;
}
function negated(a, b) {
  a |= 0;
  b |= 0;
  return -(a * b);
}
function divided(a, b) {
  a |= 0;
  b |= 0;
  return 1 / (a * b);
}
function besideDouble(a, b, x) {
  a |= 0;
  b |= 0;
  return x + a * b;
}
function besideItself(a, b) {
  a |= 0;
  b |= 0;
  const p = a * b;
  return p + p;
}
function cubed(a, b, c) {
  a |= 0;
  b |= 0;
  c |= 0;
  return a * b * c;
}
function cubedBits(a, b, c) {
  a = a >> 20;
  b = b >> 20;
  c = c >> 20;
  return (a * b * c) | 0;
}
function carried(list, x) {
  let c = 0;
  const xl = x & 0x3fff;
  const xh = x >> 14;
  for (let i = 0; i < list.length; i++) {
    let l = list[i] & 0x3fff;
    const h = list[i] >> 14;
    const m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    list[i] = l & 0xfffffff;
  }
  return c;
}
function carriedAlone(list, x) {
  let c = 0;
  for (let i = 0; i < list.length; i++) c = (x | 0) * list[i];
  return c;
}
function keyed(list, a, b) {
  a |= 0;
  b |= 0;
  return list[a * b];
}
const values = [0, 1, -1, 5, -5, 16383, -16384, 123456, -123456, 0x7fffffff, -0x80000000];
for (const a of values) {
  for (const b of values) {
    const line = [];
    for (let k = 0; k < 3; k++) {
      line.length = 0;
      line.push(masked(a, b), shifted(a, b), twoProducts(a, b, b, a), twoProducts(a, a, b, b), besideInteger(a, b, 0), besideInteger(a, b, -7), subtracted(a, b, 0), compared(a, b), is(shown(a, b)), is(sumShown(a, b, 0, -1)), is(sumShown(a, b, b, a)), is(differenceShown(a, b, 0, 3)));
      line.push(is(differenceShown(0, 3, a, b)), is(negated(a, b)), is(divided(a, b)), is(besideDouble(a, b, -0)), is(besideDouble(a, b, 0.5)), is(besideItself(a, b)), is(cubed(a, b, 0)), is(cubed(a, 0, b)), cubedBits(a, b, -1), keyed("zero one".split(" "), a, b));
    }
    console.log(a, b, line.join(" "));
  }
}
const list = [];
for (let i = 0; i < 40; i++) list[i] = (i * 7654321 + 12345) & 0xfffffff;
for (const x of values) {
  console.log(x, is(carried(list, x)), list.slice(0, 4).join());
  console.log(is(carriedAlone([3, 0, -0, 0], x)), is(carriedAlone([0, 0], x)), is(carriedAlone([-3, 0], x)));
}
