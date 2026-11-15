function tally(stock) {
  const rows = Object.entries(stock);
  let total = 0;
  for (const [name, count] of rows) total = (total + count + name.length) | 0;
  return total;
}
const stock = JSON.parse('{"apples":3,"pears":4,"plums":5,"figs":6,"limes":7,"dates":8,"kiwis":9,"melons":10}');
let sum = 0;
for (let round = 0; round < 2000; round++) sum = (sum + tally(stock)) | 0;
console.log(sum);
