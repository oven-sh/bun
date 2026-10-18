// filters records, makes a smaller record of each and sums a field of those
const operations = 100;
interface Sale {
  price: number;
  shop: number;
}
const sales: Sale[] = [];
for (let i = 0; i < operations; i++) sales.push({ price: i * 3, shop: i % 7 });
let total = 0;

kernel: {
  total += sales
    .filter(sale => sale.shop !== 3)
    .map(sale => ({ cost: sale.price + 1 }))
    .reduce((sum, item) => sum + item.cost, 0);
}

console.log(total);
