// The looks at the loops inside find narrower types than the look at the loop around, and the tries of the loops are undone for what a step brings.
const unseen = x => [x][JSON.parse("0")];
function nest(m, step) {
  let a = 0, b = 0, c = 0;
  for (let r = 0; r < m; r++) {
    for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) a += j; a += step; }
    for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) b += a; c = b; }
    for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) c += i * j; }
  }
  return typeof a + ":" + a + "|" + typeof b + ":" + b + "|" + typeof c + ":" + c;
}
for (const step of [1, 0.5, "x", true, null, undefined, 2147483648, -0]) console.log(nest(unseen(3), unseen(step)));
