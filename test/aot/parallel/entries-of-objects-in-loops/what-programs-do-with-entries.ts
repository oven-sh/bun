const said: unknown[] = [];
const cents = { tea: 300, milk: 200, bread: 400 }; type Cents = typeof cents;
let sum = 0; let last = "";
for (let i = 0; i < 200; i++) {
  const scaled = Object.fromEntries(Object.entries(cents).map(([name, value]) => [name, value + (i & 3)])) as Cents; sum += scaled.tea + scaled.bread;
  const dear = Object.fromEntries(Object.entries(cents).filter(([, value]) => value > 200 + (i & 1) * 150)); sum += Object.keys(dear).length;
  const sorted = Object.entries(cents).sort((a, b) => a[1] - b[1]); last = sorted[i % 3][0];
  sum += Object.entries(cents).reduce((total, [, value]) => total + value, 0);
  const table = new Map(Object.entries(cents)); sum += table.get("milk")! + table.size;
  for (const [name, value] of Object.entries(cents)) sum += name.length + value;
  Object.entries(cents).forEach(([name, value], at) => { sum += name.length * at + value; });
  sum += Object.entries(cents).find(([name]) => name === "milk")![1];
  sum += Object.entries(cents).flat().length + Object.entries(cents).join("|").length;
}
said.push(sum, last);
console.log(said.map(String).join(" "));
