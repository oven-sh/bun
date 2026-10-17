// formats an amount of money with an Intl.NumberFormat whose locale and options are constants
const format = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const operations = 20;
const amounts: number[] = [];
for (let i = 0; i < operations; i++) amounts.push(i * 987.65 + 0.07);
let total = 0;

kernel: {
  let length = 0;
  for (let i = 0; i < amounts.length; i++) length += format.format(amounts[i]).length;
  total += length;
}

console.log(total);
