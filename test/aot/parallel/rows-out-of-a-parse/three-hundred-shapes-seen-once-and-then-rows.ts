// Three hundred objects, each of a shape of its own that ends in a name of Row, come in front of the rows. None of them has a plan, and none takes a place that a plan needs.
// COUNTER: ObjectsParsedIntoRecords >= 240
interface Row { id: number; name: string }
let odd = 0;
for (let i = 0; i < 300; i++) {
  const one: any = JSON.parse('{"k' + i + '":' + i + ',"name":"x"}');
  odd += Object.keys(one).length;
}
let text = "[";
for (let i = 0; i < 240; i++) text += (i ? "," : "") + '{"id":' + i + ',"name":"n' + i + '"}';
text += "]";
const rows: Row[] = JSON.parse(text);
function weigh(row: Row): number {
  let w = 0;
  for (let i = 0; i < 2; i++) w = (w + i) | 0;
  return row.id + row.name.length + w;
}
let sum = 0;
for (const row of rows) sum += weigh(row);
console.log("SAID " + odd + " " + sum);
