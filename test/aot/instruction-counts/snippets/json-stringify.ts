// turns an object of three numbers and a string into JSON
type Row = { id: number; name: string; x: number; y: number };
const operations = 20;
const rows: Row[] = [];
for (let i = 0; i < operations; i++) rows.push({ id: i, name: "row" + i, x: i * 0.5, y: i * 2 });
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < rows.length; i++) length += JSON.stringify(rows[i]).length;
  total += length;
}

console.log(total);
