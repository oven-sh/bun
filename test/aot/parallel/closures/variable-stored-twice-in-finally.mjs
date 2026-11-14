// A captured variable that is stored twice in a row, in a cleanup and outside one, before the closure over it exists.
function work(n) {
  let a = 1;
  try {
    JSON.parse("1");
  } finally {
    a = a | 0;
    a ^= a >>> 3;
  }
  const part = () => {
    for (const item of [1, 2, n]) a = (a + item) | 0;
  };
  part();
  return a;
}
function caught(n) {
  let a = n, seen = "";
  try {
    JSON.parse(n > 4 ? "{" : "1");
  } catch (error) {
    a = a * 2;
    a = a + 1;
    seen = error.name;
  } finally {
    a = a | 0;
    a = a + 10;
    a ^= a >>> 1;
  }
  const part = () => { for (let i = 0; i < n; i++) a = (a * 3 + i) | 0; return seen; };
  return part() + a;
}
function straight(n) {
  let a = n;
  a = a + 1;
  a = a * 2;
  if (n === 3) return a;
  const read = () => a, write = v => { a = v; a = a + 1; };
  let sum = 0;
  for (let i = 0; i < 4; i++) { write(sum + i); sum += read(); }
  return sum;
}
function branches(n) {
  let a = 0, b = 0;
  a = n;
  b = a;
  a = b + 1;
  b = a * 2;
  if (n & 1) {
    a = 5;
    a = a + n;
    const f = () => a + b;
    return [1, 2, 3].map(x => x + f()).join();
  }
  b = 7;
  b = b - n;
  const g = () => (a += b);
  for (let i = 0; i < 3; i++) g();
  return a + "/" + b;
}
function thrown(n) {
  let a = 1;
  const seen = [];
  for (let round = 0; round < 3; round++) {
    try {
      a = a + 1;
      a = a * 2;
      if (round === n) throw new Error("round " + round);
    } catch (error) {
      a = -a;
      a = a - 1;
      seen.push(error.message);
    } finally {
      a = a + round;
      a ^= 1;
    }
    const keep = () => a;
    seen.push(keep());
  }
  return seen.join(" ");
}
for (const n of [3, 5]) console.log(work(n));
for (const n of [0, 1, 2, 3, 4, 5, 6]) console.log(work(n), caught(n), straight(n), branches(n), thrown(n));
