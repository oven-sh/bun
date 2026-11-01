const small = [1, 2, 3, 4, 5, 6, 7, 8];
const holey = [1, , 3, , 5];
const negative = [-1, -2147483648, 2147483647, 0];
const empty = [];
const pushed = [];
for (let k = 0; k < 5; k++) pushed.push(k * 7);

function show(list) {
  let text = list.length + ":";
  for (let k = 0; k < list.length; k++) text += k in list ? (Object.is(list[k], -0) ? " -0" : " " + String(list[k])) : " hole";
  return text;
}
function withTriple(list, i) {
  return list.concat(i * 3);
}
function smallWithTriple(i) {
  const b = small.concat(i * 3);
  return (b[i & 3] ?? 0) + (b[8] ?? 0);
}
function holeyWithTriple(i) {
  const b = holey.concat(i * 3);
  return show(b) + " | " + (1 in b) + " " + (b[1] ?? "none") + " " + b[5];
}
function summed(i) {
  const b = small.concat(i * 3, i * 5);
  let sum = 0;
  for (let k = 0; k < b.length; k++) sum += b[k];
  return sum;
}
function listAndNumber(i) {
  return small.concat(pushed, i * 3, negative);
}
function usedFurther(i) {
  const b = small.concat(i * 3);
  const found = [b.indexOf(3), b.indexOf(i * 3), b.includes(8), b.includes(NaN), b.lastIndexOf(1)];
  const again = b.concat(b);
  const withSmall = b.concat(small);
  const sorted = b.slice().sort((x, y) => y - x);
  b.push(0.5);
  b.push("text");
  b[0] = { a: 1 };
  b.length = 12;
  return [found.join(), show(again), show(withSmall), show(sorted), show(b.map(x => typeof x)), JSON.stringify(b)].join(" | ");
}

for (const i of [0, 1, 5, 715827882, 715827883, 1e9, -1e9, 0.5, -0, NaN, Infinity]) {
  console.log("small", i, smallWithTriple(i), summed(i));
  console.log("holey", i, holeyWithTriple(i));
  console.log("lists", i, show(listAndNumber(i)));
  for (const list of [small, holey, negative, empty, pushed]) console.log("any", i, show(withTriple(list, i)));
}
for (const i of [2, 1e9, 0.25]) console.log("further", i, usedFurther(i));
let total = 0;
for (let i = 0; i < 300000; i++) total = (total + smallWithTriple(i) + summed(i)) % 1000003;
console.log("many", total);
console.log("untouched", show(small), show(holey), show(negative), show(pushed));
