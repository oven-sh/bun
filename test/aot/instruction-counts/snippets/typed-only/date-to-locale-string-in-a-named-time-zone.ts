// writes a date with toLocaleString in a constant named time zone
const operations = 20;
const dates: Date[] = [];
for (let i = 0; i < operations; i++) dates.push(new Date(1_700_000_000_000 + i * 86_400_123));
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < dates.length; i++) length += dates[i].toLocaleString("en-US", { timeZone: "America/New_York" }).length;
  total += length;
}

console.log(total);
