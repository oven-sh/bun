"use strict";
let bytes, numbers, log = [];
function make(size) {
  try {
    bytes = new Uint8Array(size);
  } catch {
    return false;
  }
  return true;
}
function store(position, value) {
  bytes[position] = value;
}
function load(position) {
  return bytes[position];
}
function fill(from, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) bytes[from + k] = k + 1;
  for (let k = 0; k < count; k++) sum += bytes[from + k];
  return sum;
}
function blocks(position) {
  const first = bytes[position], second = bytes[position + 1], third = bytes[position - 1];
  bytes[position + 2] = (first | 0) + 1;
  return [first, second, third, bytes[position + 2]].join();
}
function double(position) {
  return bytes[position * 1.0] + bytes[position + 0.0];
}
function all(end) {
  store(end - 1, 7);
  log.push(load(end - 1), load(end), load(end + 5), load(-1), fill(end - 20, 16), fill(end - 8, 16), blocks(end - 4), blocks(end - 1), double(end - 2));
  bytes[end - 3] += 5;
  log.push(bytes[end - 3]++, bytes[end - 3]);
}
make(64);
all(64);
console.log(log.splice(0).join(" "));
const great = 2 ** 31 + 64;
if (!make(great)) console.log("no great view");
else {
  all(great);
  log.push(fill(2 ** 31 - 8, 16), fill(2 ** 31 - 40, 16), blocks(2 ** 31), blocks(2 ** 31 - 1));
  bytes = null;
  console.log(log.splice(0).join(" "));
}
function makeNumbers(length) {
  try {
    numbers = new Float64Array(length);
  } catch {
    return false;
  }
  return true;
}
function sum(from, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) numbers[from + k] = k + 0.5;
  for (let k = 0; k < count; k++) sum += numbers[from + k];
  return sum;
}
function three(position) {
  return [numbers[position - 1], numbers[position], numbers[position + 1]].join();
}
if (!makeNumbers(2 ** 28 + 8)) console.log("no great view");
else {
  numbers[2 ** 28] = 0.25;
  log.push(numbers[2 ** 28], three(2 ** 28), sum(2 ** 28 - 4, 12), three(2 ** 28 + 7), sum(2 ** 28 + 4, 8));
  numbers = null;
  console.log(log.join(" "));
}
