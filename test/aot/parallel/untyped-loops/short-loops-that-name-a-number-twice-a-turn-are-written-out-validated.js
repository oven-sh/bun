// Flags: --aot-validate
// The two loops are written out: twenty-five times `a -= a - b`, and `a` is truncated behind every five of them.
function settle(x, y) {
  let a = x;
  let b = y;
  let c = 100;
  let e = 3;
  let f = b - 1;
  for (let outer = 5; outer > 0; outer--) {
    e &= Math.imul(f, a);
    for (let inner = 5; inner > 0; inner--) {
      a -= a - b;
      c = Math.min((e + e) | 0, b >> 255);
    }
  }
  for (let turn = 3; turn > 0; turn--) {
    e = c;
    if (1073741824 === b) {
      a = Math.max(e, c) ^ (e + a);
      f = a;
    } else {
      f = b;
      a = 31 & a & a;
    }
  }
  for (let turn = 0; turn !== 3; turn++) f--;
  f -= -65535;
  return [a, b, c, e, f].join();
}

const pairs = [
  [5, -2147483648],
  [0, 1],
  [2147483644, 2147483647],
  [-2147483651, 0],
  [null, 0],
  [4294967296, 1],
];
for (const [x, y] of pairs) console.log(settle(x, y));
