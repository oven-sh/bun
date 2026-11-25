'use strict';
const make = i => ({ x: i + 0.5, y: i % 7, z: i * 3 });
const own = [make(1), make(2), make(3)];
const parsed = JSON.parse('[{"x":0.5,"y":0,"z":0},{"x":1.5,"y":1,"z":3},{"z":6,"y":2,"x":2.5},{"x":3.5,"y":3,"z":9,"more":1}]');
function totalOfParsed(from) {
  let sum = from & 1;
  for (let i = 0; i < parsed.length; i++) { const row = parsed[i]; sum += row.x * 2 + row.y - row.z; }
  return sum;
}
function totalOfOwn(from) {
  let sum = from & 1;
  for (let i = 0; i < own.length; i++) { const row = own[i]; sum += row.x * 2 + row.y - row.z; }
  return sum;
}
function eachOfParsed(from) {
  let sum = from & 1;
  for (const row of parsed) sum += row.x * 2 + row.y - row.z;
  return sum;
}
for (let turn = 0; turn < 3; turn++) console.log(totalOfParsed(turn), totalOfOwn(turn), eachOfParsed(turn));
