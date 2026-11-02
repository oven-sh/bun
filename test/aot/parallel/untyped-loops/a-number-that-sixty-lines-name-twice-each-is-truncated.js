// Every line names `a` twice, so 2^60 ways lead from the last `a` back to the first.
function settle(a, b) {
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  a -= a - b;
  return a | 0;
}

function settleOnSums(a, b) {
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  a = a + b - a;
  return (a & 1023) + (a >>> 28);
}

const pairs = [
  [5, 7],
  [0.5, 1],
  [2147483644.25, 2147483647],
  [-3, 0],
  [4294967296, 1],
  [1e300, 5],
  [-0, -2147483648],
  [NaN, 3],
  [Infinity, 3],
];
for (const [a, b] of pairs) console.log(a, b, settle(a, b), settleOnSums(a, b));
