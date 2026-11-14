// The text outgrows its buffer in every place of an array.
interface Row {
  key: string;
  values: (string | number)[];
}
let sum = 0;
for (let length = 0; length < 400; length++) {
  const rows: Row[] = [];
  for (let i = 0; i < 12; i++) rows.push({ key: "k" + i, values: Array.from({ length: i * 3 }, (_, j) => (j % 2 ? "v".repeat((length + j) % 70) : j * length)) });
  const text = JSON.stringify(rows);
  const back = JSON.parse(text) as Row[];
  for (let i = 0; i < rows.length; i++) if (back[i]!.values.join() !== rows[i]!.values.join()) console.log("differs", length, i);
  sum += text.length;
}
console.log(sum);
