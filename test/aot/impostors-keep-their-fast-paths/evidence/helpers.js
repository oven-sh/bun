import barrel from "./barrel/index.cjs";

function sumOfPrices() {
  let total = 0;
  for (let i = 0; i < 100; i++) total += barrel.priceOfTea + barrel.priceOfMilk;
  return total;
}

export const cases = {
  "a module exports the members of another through the helper that TypeScript emits": {
    prepare: () => 0,
    turn: sumOfPrices,
  },
};
