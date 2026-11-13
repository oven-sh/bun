// STATISTIC: FreshArrayWritesNarrowed >= 2
// A push onto an array that only this function names leaves what is known of other arrays. What is read of the array itself, of its other names and of arrays that it is stored in is read again.
function multiply(a, b) {
  const product = [];
  for (let i = 0; i < 2; i++) {
    const row = [];
    for (let j = 0; j < 2; j++) {
      let sum = 0;
      for (let k = 0; k < 2; k++) sum += a[i][k] * b[k][j];
      row.push(sum);
    }
    product.push(row);
  }
  return product;
}
function itself(a) {
  const made = [];
  let text = "";
  for (let i = 0; i < a.length; i++) {
    made.push(a[i]);
    text += made.length + ":" + made[0] + "," + made[i] + "," + a[0] + ";";
    made.push(a[i]);
    text += made.length + ":" + made[made.length - 1] + "," + a[i] + ";";
    made.pop();
    text += made.length;
  }
  return text;
}
function otherNames(a, flag) {
  const made = [];
  const other = flag ? made : a;
  let text = "";
  for (let i = 0; i < 3; i++) {
    made.push(i);
    text += other.length + "/" + other[0] + ";";
    other.push("o" + i);
    text += made.length + "/" + made[made.length - 1] + ";";
  }
  return text;
}
function stored(a) {
  const inner = [];
  const outer = [inner, a];
  let text = "";
  for (let i = 0; i < 3; i++) {
    inner.push(i);
    text += outer[0].length;
    outer[i & 1].push("s");
    text += inner.length + "" + a.length;
  }
  return text;
}
function seen(a) {
  const made = [];
  const tell = () => made.length;
  let text = "";
  for (let i = 0; i < 3; i++) {
    made.push(a[0]);
    text += tell();
    made.push(made);
    text += made.length + "" + made[made.length - 1].length;
  }
  return text;
}
function shifts(a) {
  const made = a.slice();
  let text = "";
  for (let i = 0; made.length; i++) {
    text += String(made[0]) + "," + a[0] + ";";
    made.shift();
    if (i === 0) made.unshift("u", "v");
    text += made[0] + "," + a.length + ";";
  }
  return text;
}
const said = [];
for (const a of [
  [
    [1, 2],
    [3, 4],
  ],
  [
    [0.5, -0],
    [NaN, 2 ** 31],
  ],
  [
    ["2", null],
    [undefined, true],
  ],
  [[1], [, 2]],
])
  said.push(JSON.stringify(multiply(a, [[5, 6], [7, 8]])), JSON.stringify(multiply(a, a)));
for (const a of [[1, 2, 3], [0.5, 2], ["x", null, {}], [, 1]])
  said.push(itself(a), otherNames(a.slice(), true), otherNames(a.slice(), false), stored(a.slice()), seen(a), shifts(a));
console.log(said.join("\n"));
