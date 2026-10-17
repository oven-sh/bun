// parses JSON of three numbers and a string
type Row = { id: number; name: string; x: number; y: number };
const operations = 20;
const texts: string[] = [];
for (let i = 0; i < operations; i++) texts.push(`{"id":${i},"name":"row${i}","x":${i * 0.5},"y":${i * 2}}`);
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < texts.length; i++) sum += (JSON.parse(texts[i]) as Row).y;
  total += sum;
}

console.log(total);
