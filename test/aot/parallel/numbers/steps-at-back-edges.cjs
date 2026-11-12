// l = a[i++] .. b[j++] = l: the next counters are made at the back edge. Where an iteration leaves its version behind a step, it goes on with the counters of its own.
function carry(a, i, x, b, j, c, n) {
  var xl = x & 0x3fff, xh = x >> 14;
  while (--n >= 0) {
    var l = a[i] & 0x3fff;
    var h = a[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return [c, i, j, n].join();
}
function find(a, i, j, n, sought) {
  var seen = 0;
  while (n-- > 0) {
    if (a[i++] === sought) return ["found", i, j, n, seen].join();
    j += 2;
    if (a[j] === sought) break;
    seen += i;
  }
  return [i, j, n, seen].join();
}
function backward(a, b, i, j) {
  var s = 0;
  while (j >= 0) {
    s = (s + a[j--] * 3) | 0;
    if (s & 64) continue;
    b[++i] = s + j;
  }
  return [s, i, j].join();
}
function both(a, b, n) {
  var i = 0, j = 0, s = 0;
  while (i < n) {
    s += a[i++];
    b[j] = i + j++;
    s += b[i - 1] - j;
  }
  return [s, i, j].join();
}
const said = [];
const odd = [undefined, 1.5, "7", { valueOf() { return 9; } }, null, -0, 2147483647, 4294967296];
for (let round = 0; round < 40; round++) {
  const a = [], b = [];
  for (let k = 0; k < 40; k++) a.push((k * 7654321 + round * 12345) & 0xfffffff), b.push(0);
  if (round % 4 === 3) (round & 8 ? a : b)[(round * 5) % 40] = odd[round % odd.length];
  if (round === 30) delete a[7];
  if (round === 34) b.length = 9;
  said.push(carry(a, round % 3, a[(round * 3) % 40] & 0xfffffff, b, round & 7, 0, 30), b.slice(0, 10).join());
  said.push(find(a, 0, round % 5, 20, round % 2 ? a[round % 40] : -1));
  said.push(backward(a, b, -1, 39 - (round % 3)), b.slice(0, 6).join());
  said.push(both(a, b, 20), b.slice(0, 6).join());
}
console.log(said.join("\n"));
