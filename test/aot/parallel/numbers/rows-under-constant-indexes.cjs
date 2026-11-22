// STATISTIC: ArraysGuardedInIterations >= 2
// Loops over points [x, y] that read and store under constant indexes in several blocks. Some points are not as the others are.
const points = [], folded = [], turned = [];
for (let i = 0; i < 24; i++) {
  points.push([i * 2.5 - 20.25, i * -1.25 + 8.125]);
  folded.push([i * 0.5 - 4.25, 3.125 - i * 0.25]);
  turned.push([i * 0.25 + 0.5, 4.5 - i * 0.375]);
}
function clamp(r) {
  for (let i = 0; i < 24; i++) {
    const p = points[i];
    p[0] += 0.125;
    p[1] -= 0.125;
    if (p[0] > 20) p[0] = -20.5;
    if (p[1] < -20) p[1] = 20.25;
  }
  return points[3][0];
}
function fold(k) {
  let s = 0;
  for (let i = 0; i < 24; i++) {
    const p = folded[i];
    p[0] += 0.25;
    p[1] *= 0.5;
    if (p[0] > k) p[1] = p[0] * 0.5;
    if (p[1] > 1.5) p[0] = p[1] - k;
    s += p[0] + p[1];
  }
  return s;
}
function turn(c, s) {
  let most = -1e9;
  for (let i = 0; i < 24; i++) {
    const p = turned[i], x = p[0], y = p[1];
    if (x > y) p[0] = x * c - y * s;
    p[1] = x * s + y * c;
    if (p[0] > most) most = p[0];
  }
  return most;
}
const show = v => (Object.is(v, -0) ? "-0" : "" + v);
function say(name) {
  let t = name + " " + show(clamp(1)) + " " + show(fold(2)) + " " + show(fold(-1.5)) + " " + show(turn(0.75, 0.5)) + " " + show(turn(1, 0));
  for (let i = 0; i < 24; i++) t += " " + show(points[i][0]) + "," + show(points[i][1]) + "," + show(folded[i][0]) + "," + show(folded[i][1]) + "," + show(turned[i][0]) + "," + show(turned[i][1]);
  console.log(t);
}
say("doubles");
points[5][1] = NaN;
folded[6][0] = NaN;
turned[7][0] = NaN;
say("NaN");
points[8][0] = -0;
folded[8][1] = -0;
say("zeros");
points[9][0] = Infinity;
folded[9][1] = -Infinity;
say("infinity");
points[10] = [30, 2];
folded[11] = [3, -2];
turned[12] = [1, 5];
say("integers");
points[13] = points[14];
folded[15] = folded[16];
turned[17] = turned[18];
say("alias");
points[19].length = 1;
say("short");
