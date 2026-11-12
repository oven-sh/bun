const saved = [];
function each(list, f, depth) {
  if (depth > 0) return each(list, f, depth - 1) + 1;
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += f(list[i], i);
    if (list[i] === 2) saved.push(f);
  }
  for (let i = list.length - 1; i >= 0; i--) sum -= i * 3;
  for (const value of list) sum = (sum * 31 + value) | 0;
  return sum;
}
function outer(k) {
  let seen = 0;
  const size = each(
    [1, 2, 3],
    (v, i) => {
      seen += v * k + i;
      return seen;
    },
    2,
  );
  return size + ":" + seen;
}
let text = "";
for (let i = 0; i < 5; i++) text += outer(i) + " ";
console.log(text);
console.log(saved.length, saved.map(f => f(10, 1)).join(), saved.map(f => f(1, 0)).join(), saved[0] === saved[1]);
