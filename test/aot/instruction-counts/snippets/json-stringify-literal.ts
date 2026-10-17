// turns a literal of a string and two numbers, written in the call itself, into JSON
const operations = 20;
const names: string[] = [];
for (let i = 0; i < operations; i++) names.push("row" + i);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < names.length; i++) length += JSON.stringify({ name: names[i], x: i * 0.5, y: i }).length;
  total += length;
}

console.log(total);
