"use strict";
// a record of the file has the names, and the list made in the function is filled with rows out of a parse alone: by shift and by an index
const rows = JSON.parse('[{"town":1,"count":2},{"count":4,"town":3},{"town":5,"count":6,"more":7}]');
const home = [{ town: 1, count: 2 }];
function byShift(t) { const queue = []; for (let i = 0; i < rows.length; i++) queue.push(rows[i]); let s = home[0].town + home[0].count + t; while (queue.length) { const { town, count } = queue.shift(); s = (s + town * 3 + count) | 0; } return s; }
function byIndex(t) { const list = []; for (let i = 0; i < rows.length; i++) list.push(rows[i]); let s = home[0].town + home[0].count + t; for (let i = 0; i < list.length; i++) { const { town, count } = list[i]; s = (s + town * 3 + count) | 0; } return s; }
let sum = 0; for (let t = 0; t < 300; t++) sum = (sum + byShift(t) * 7 + byIndex(t)) % 1000003;
console.log(sum);
