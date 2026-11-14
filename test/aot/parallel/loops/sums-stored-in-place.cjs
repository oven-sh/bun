// A list that is made here is changed under known indexes: what is stored is stored as the number it is.
function add(self, v) {
  self[0] += v[0];
  self[1] += v[1];
  self[2] += v[2];
  return self;
}
function scale(v, by) {
  return [v[0] * by, v[1] * by, v[2] * by];
}
function between(a, b, steps) {
  const out = [];
  for (let k = 0; k < steps; k++) out.push(add(scale(a, k / steps), scale(b, 1 - k / steps)));
  return out;
}
function mixed(a, text) {
  const made = [a[0] * 0.5, a[1], 3];
  made[0] = a[2] * 2;
  made[1] = text;
  made[2] += 1;
  made[0] -= 0.25;
  return made;
}
const show = (rows) => rows.map((row) => row.map((x) => (Object.is(x, -0) ? '-0' : `${x}`)).join()).join(';');
const out = [];
for (let turn = 0; turn < 40; turn++) out.push(show(between([turn, 0.5, -turn], [1, 2, 3], 5)), show(between([0, -0, 4], [0, -0, 2], 2)));
out.push(show(between([NaN, 1, Infinity], [1, , 2], 3)), show(between([1, 2], [3], 2)), show(between(['1', '2', 'x'], [1, 2, 3], 2)));
for (let turn = 0; turn < 20; turn++) out.push(show([mixed([turn, 2, 0.5], 'text'), mixed([turn, 2, 1], turn), mixed([0.5, 1.5, NaN], undefined), mixed([1, 2, 3], null)]));
console.log(out.join(' '));
