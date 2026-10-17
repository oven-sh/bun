// writes a date as ISO 8601 text
const operations = 20;
const dates: Date[] = [];
for (let i = 0; i < operations; i++) dates.push(new Date(1_700_000_000_000 + i * 86_400_123));
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < dates.length; i++) length += dates[i].toISOString().length;
  total += length;
}

console.log(total);
