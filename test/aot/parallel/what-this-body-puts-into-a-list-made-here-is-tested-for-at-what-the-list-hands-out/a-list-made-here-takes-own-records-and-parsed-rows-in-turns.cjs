"use strict";
// one list made in the function takes rows out of a parse and records of the file in turns; rows come in two orders of their names, one lacks a name, one has a text for a number
const rows = JSON.parse('[{"town":1,"count":2},{"count":4,"town":3},{"town":5},{"town":"7","count":8},{"town":9,"count":10,"more":1}]');
function drain(t) {
  const queue = [];
  for (let i = 0; i < rows.length; i++) { queue.push(rows[i]); queue.push({ town: i + t, count: i }); }
  let said = "";
  while (queue.length) { const { town, count } = queue.shift(); said += town + ":" + count + " "; }
  return said;
}
let last = ""; for (let t = 0; t < 300; t++) last = drain(t);
console.log(last);
