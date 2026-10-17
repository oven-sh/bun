// renders an array of records with map() and join() inside a template
const operations = 16;
const records: { name: string; count: number }[] = [];
for (let i = 0; i < operations; i++) records.push({ name: "name" + i, count: i });
let total = 0;

kernel: {
  total += `<ul>${records.map(record => `<li class="record">${record.name}</li>`).join("\n")}</ul>`.length;
}

console.log(total);
