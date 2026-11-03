// `f` enters the loop as undefined while `b` and `c` enter as integers, and each turn hands one variable's value to the next.
function changesPlaces(y, z) {
  let b = y,
    c = z,
    f = undefined,
    g = 9;
  while (c !== f && g-- > 0) {
    b ^= 1;
    c = (Math.imul(c, 31) + z) | 0;
    {
      const t = b;
      b = f;
      f = t;
    }
  }
  return [b, c, f].map(String).join();
}
for (const [y, z] of [[1, 2]]) console.log(changesPlaces(y, z));

function startsWithNull(y, z) {
  let b = y,
    c = z,
    f = null,
    g = 9;
  while (c !== f && g-- > 0) {
    b ^= 1;
    c = (Math.imul(c, 31) + z) | 0;
    {
      const t = b;
      b = f;
      f = t;
    }
  }
  return [b, c, f].map(String).join();
}
for (const [y, z] of [[1, 2]]) console.log(startsWithNull(y, z));

function takesFourPairs(y, z) {
  let b = y,
    c = z,
    f = undefined,
    g = 9;
  while (c !== f && g-- > 0) {
    b ^= 1;
    c = (Math.imul(c, 31) + z) | 0;
    {
      const t = b;
      b = f;
      f = t;
    }
  }
  return [b, c, f].map(String).join();
}
for (const [y, z] of [
  [1, 2],
  [3, 4],
  [0, 0],
  [-5, 7],
])
  console.log(takesFourPairs(y, z));

function comparesLoosely(y, z) {
  let b = y,
    c = z,
    f = undefined,
    g = 9;
  while (c != f && g-- > 0) {
    b ^= 1;
    c = (c + z) | 0;
    {
      const t = b;
      b = f;
      f = t;
    }
  }
  return [b, c, f].map(String).join();
}
const pairs = [
  [1, 2],
  [6, 5],
];
for (let i = 0; i < pairs.length; i++) console.log(comparesLoosely(pairs[i][0], pairs[i][1]));

function firstVariableIsMissing(y, z) {
  let b = y,
    c = z,
    f = 4,
    g = 5;
  while (c !== f && g-- > 0) {
    b ^= 1;
    c = (Math.imul(c, 31) + z) | 0;
    {
      const t = b;
      b = f;
      f = t;
    }
  }
  return [b, c, f].map(String).join();
}
for (const [z, y] of [[2]]) console.log(firstVariableIsMissing(y, z));
