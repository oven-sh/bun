// turns an object of a number, a string and two dates into JSON
type Row = { id: number; name: string; created: Date; closed: Date | null };
const operations = 20;
const rows: Row[] = [];
for (let i = 0; i < operations; i++) rows.push({ id: i, name: "row" + i, created: new Date(1_700_000_000_000 + i * 86_400_123), closed: new Date(1_800_000_000_000 + i * 86_400_123) });
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < rows.length; i++) length += JSON.stringify(rows[i]).length;
  total += length;
}

console.log(total);
