// Doubles, numbers that are whole, null, undefined and booleans beside strings, again and again: many doubles that share places of a table, zeros of both signs, NaN, and collections between.
const doubles = [0.5, -0.5, 1.5, 2.25, -0, 0, NaN, Infinity, -Infinity, 1e21, 1e-7, 2 ** 53, 2 ** 31, -(2 ** 31) - 1, 4294967296.25, 5e-324, 1.7976931348623157e308, 0.1 + 0.2, 100, -1];
for (let i = 1; i < 300; i++) doubles.push(i / 8, -i / 1024, i * 1e15 + 0.5);
const others = [null, undefined, true, false, "", "t", 7, 1023, 1024, 12345678901234567890n];
function append(text, value) {
  return `${text}${value}`;
}
function prepend(value, text) {
  return value + text;
}
function both(first, second) {
  return `${first}/${second}`;
}
function line(marks) {
  let text = "";
  for (let i = 0; i < marks.length; i++) {
    text = `${text.slice(-40)}${marks[i]}`;
    take(text);
  }
  return text;
}
let hash = 0;
function take(text) {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
}
for (let turn = 0; turn < 6; turn++) {
  for (const value of doubles) {
    take(append("<", value));
    take(prepend(value, ">"));
    if (value !== parseFloat(append("", value)) && value === value) console.log("other number", value);
  }
  for (const value of others) take(append("a", value) + prepend(value, "b") + both(value, doubles[turn]));
  console.log(line(doubles), line(others), line(doubles.slice(0, 30)));
  if (turn % 2) globalThis.Bun?.gc(true);
}
console.log(hash);
console.log(doubles.slice(0, 20).map(value => append("", value)).join(" "));
console.log(others.map(value => append("", value)).join(" "), append("", others[1]), prepend(null, "n"));
for (const value of [Symbol("s"), Object.create(null)]) {
  try {
    console.log(append("", value));
  } catch (error) {
    console.log(error.name);
  }
}
