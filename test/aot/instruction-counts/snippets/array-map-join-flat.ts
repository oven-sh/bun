// renders an array of records with map() and join() and reads a character of the result
const operations = 16;
const records: { name: string; count: number }[] = [];
for (let i = 0; i < operations; i++) records.push({ name: "name" + i, count: i });
let total = 0;

kernel: {
  total += records.map(record => `<li class="record">${record.name}</li>`).join("\n").charCodeAt(5);
}

console.log(total);
