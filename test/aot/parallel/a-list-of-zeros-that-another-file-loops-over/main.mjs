// A test of whether a list still has the elements that were written names elements that no literal is made of where a list of zeros is made without its data.
import { threeZeros, weights, zeros } from "./lists.mjs";
const perSlot = () => {
  const most = [0, 0, 0, 0];
  let i = 0;
  for (const u of zeros) most[zeros[i]] += weights[i - 1] ?? u;
  return most.join();
};
const sum = () => {
  let total = 0;
  for (const u of threeZeros) total += threeZeros[0] + u;
  return total;
};
console.log(perSlot(), sum());
