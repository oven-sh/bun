import data from "./data.json";
let sum = 0;
for (const row of data.rows) sum += row.count;
console.log(data.title, sum);
