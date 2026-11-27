// Lists filled at keys that are shifted, with bits put together
function stack(bricks) {
  const rows = [];
  for (let brick = 0; brick < bricks.length; brick++) rows[brick >> 1] |= bricks[brick] % 4096 << (brick % 2 ? 0 : 12);
  rows[0] ^= 5;
  const again = [];
  for (let brick = 0; brick < bricks.length; brick++) again.push((rows[brick >>> 1] >>> (brick % 2 ? 0 : 12)) & 4095);
  return rows.join() + " " + again.join() + " " + rows.length;
}
console.log(stack([1, 2, 3, 4, 5]));
console.log(stack([255, 254, 253, 252, 251, 250, 249, 248]));
console.log(stack([0]));
