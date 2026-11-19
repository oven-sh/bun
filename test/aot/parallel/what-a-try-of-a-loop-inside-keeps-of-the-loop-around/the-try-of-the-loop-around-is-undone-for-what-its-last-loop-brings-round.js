// The last loop in the row brings something round the loop around that its try did not count on: the try is undone behind the tries of all loops inside.
const unseen = x => [x][JSON.parse("0")];
function late(m, last) {
  let sum = 0, x0 = 0, x1 = 0, x2 = 0;
  for (let r = 0; r < m; r++) {
    for (let i = 0; i < m; i++) x0 += i * 0.5 + sum;
    for (let i = 0; i < m; i++) x1 += i * 0.5;
    for (let i = 0; i < m; i++) { x2 += i * 0.5; if (r === 1 && i === 0) sum = last; }
  }
  return typeof sum + ":" + sum + "|" + typeof x0 + ":" + x0 + "|" + x1 + "|" + x2;
}
for (const last of [7, 0.25, "s", null, undefined, true]) console.log(late(unseen(4), unseen(last)));
