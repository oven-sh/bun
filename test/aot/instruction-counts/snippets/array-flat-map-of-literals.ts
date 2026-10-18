// flattens two numbers out of some records with flatMap and asks how many there are
interface Parcel {
  weight: number;
  stops: number;
}
const operations = 60;
const parcels: Parcel[] = [];
for (let i = 0; i < operations; i++) parcels.push({ weight: i * 3, stops: i % 4 });
let total = 0;

kernel: {
  total += parcels.flatMap(parcel => (parcel.stops > 1 ? [parcel.weight, parcel.stops] : [])).length;
}

console.log(total);
