// (sum + list[i]) | 0 takes the low word of the sum whatever the element is: a whole number of any size, a fraction, -0, NaN, an infinity, a hole.
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (total + list[i]) | 0;
  return total;
}
function sumElementFirst(list) {
  let total = 7;
  for (let i = 0; i < list.length; i++) total = (list[i] + total) | 0;
  return total;
}
function difference(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (total - list[i]) | 0;
  return total;
}
function differenceFromElement(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (list[i] - total) | 0;
  return total;
}
function twoElements(list) {
  let total = 0;
  for (let i = 1; i < list.length; i++) total = (total + list[i] + list[i - 1]) | 0;
  return total;
}
function lowByte(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = (total + list[i]) & 255;
  return total;
}
function shifted(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = ((total + list[i]) >>> 1) | 0;
  return total;
}
function product(list) {
  let total = 1;
  for (let i = 0; i < list.length; i++) total = (total * 31 + list[i]) | 0;
  return total;
}
function field(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) total = (total + points[i].x) | 0;
  return total;
}
function passedOn(total, element) {
  return (total + element) | 0;
}
function summedThroughCalls(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total = passedOn(total, list[i]);
  return total;
}

const lists = [
  JSON.parse("[1,2,3,4,5]"),
  JSON.parse("[2147483647,1,2147483647,2147483647]"),
  JSON.parse("[-2147483648,-1,-2147483648]"),
  JSON.parse("[2147483648,4294967295,4294967296,4294967297,-4294967297]"),
  JSON.parse("[9007199254740991,1,9007199254740992,1e21,-1e21,1.7976931348623157e308]"),
  JSON.parse("[0.5,0.5,1.5,-0.5,2147483647.5,-2147483648.5,-2147483649]"),
  [0, -0, 1, -0, 0.1, -0],
  [-0],
  [NaN, 1, 2, NaN, 3],
  [Infinity, 5, -Infinity, 6],
  [1, , 3, , 5],
  [1, 2.5, 3, 4.5, 5, 6.5, 7],
  [1e300, 2147483647, 5e-324, 1, -5e-324],
];

const seen = [];
for (const list of lists) {
  const copy = () => list.slice();
  seen.push(
    sum(copy()),
    sumElementFirst(copy()),
    difference(copy()),
    differenceFromElement(copy()),
    twoElements(copy()),
    lowByte(copy()),
    shifted(copy()),
    product(copy()),
    field(Array.from(copy(), x => ({ x }))),
    summedThroughCalls(copy()),
  );
}
console.log(seen.join(" "));

const long = JSON.parse("[" + Array.from({ length: 1000 }, (_, k) => (k * 2654435761) % 4294967311).join() + "]");
let total = 0;
for (let round = 0; round < 2000; round++) total = (total + sum(long) + difference(long)) | 0;
console.log(total, sum(long), product(long));
