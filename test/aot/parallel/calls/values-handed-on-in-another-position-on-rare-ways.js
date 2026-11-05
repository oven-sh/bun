// Parameters and results of calls are handed on to other calls in other positions, on ways that are rarely taken.
function three(a, b, c) {
  return a * 100 + b * 10 + c;
}
function threeTexts(a, b, c) {
  return a + "|" + b + "|" + c;
}
function same(x) {
  return x;
}

function swapped(a, b, rare) {
  if (rare) return three(b, a, 0);
  return a - b;
}
function turned(a, b, c, rare) {
  if (rare) return three(c, a, b);
  return a + b + c;
}
function turnedBack(a, b, c, rare) {
  if (rare) return three(b, c, a);
  return a + b - c;
}
function resultSecond(x, rare) {
  const r = same(x + 1);
  if (rare) return three(x, r, r);
  return r + 1;
}
function resultLast(x, y, rare) {
  const r = same(x + y);
  if (rare) return three(y, x, r);
  return r ^ x;
}
function fractions(a, b, c, rare) {
  if (rare) return three(c + 0.5, a + 0.25, b);
  return a * b + c;
}
function texts(a, b, c, rare) {
  if (rare) return threeTexts(c, a, b);
  return a.length + b.length + c.length;
}
async function mix(promise) {
  let bits = 0;
  bits ^= await promise;
  bits ^= await promise;
  bits ^= await promise;
  return bits;
}

const sums = { swapped: 0, turned: 0, turnedBack: 0, resultSecond: 0, resultLast: 0, fractions: 0, texts: "" };
let lengths = 0;
for (let i = 0; i < 40000; ++i) {
  const rare = i % 1999 === 0;
  sums.swapped += swapped(i & 7, i & 3, rare);
  sums.turned += turned(i & 7, i & 3, i & 1, rare);
  sums.turnedBack += turnedBack(i & 7, i & 3, i & 1, rare);
  sums.resultSecond += resultSecond(i & 15, rare);
  sums.resultLast += resultLast(i & 15, i & 5, rare);
  sums.fractions += fractions((i & 7) / 2, (i & 3) / 4, i & 1, rare);
  const text = texts("a" + (i & 3), "bb", "c" + (i & 1), rare);
  if (typeof text === "string") sums.texts += text + ";";
  else lengths += text;
}
console.log(JSON.stringify(sums), lengths);

const awaited = [5, 6.75, "7", true, null, undefined, { valueOf: () => 9 }, -0, 2 ** 40 + 3, NaN];
let all = [];
for (let i = 0; i < 6000; ++i) {
  const value = i % 599 === 0 ? awaited[(i / 599) | 0] : i & 255;
  const bits = await mix(Promise.resolve(value));
  if (i % 599 === 0) all.push(bits);
}
console.log(all.join(" "));
