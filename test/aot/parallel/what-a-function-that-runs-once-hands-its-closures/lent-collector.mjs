function total(callback, count) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const each = (n) => callback(n) | 0;
  return (work + each(1) + each(count)) | 0;
}
function boot(base) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return (work + total((x) => (x + base) | 0, 5)) | 0;
}
function dig(depth) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return depth > 0 ? (dig(depth - 1) + work) | 0 : 0;
}
console.log(boot(10));
console.log(dig(300));
const kept = [];
for (let i = 0; i < 20000; i++) kept.push({ i, text: "n" + i });
Bun.gc(true);
console.log(dig(300));
Bun.gc(true);
let sum = 0;
for (let i = 0; i < kept.length; i++) sum = (sum + kept[i].text.length) | 0;
console.log(kept.length, sum > 0);
