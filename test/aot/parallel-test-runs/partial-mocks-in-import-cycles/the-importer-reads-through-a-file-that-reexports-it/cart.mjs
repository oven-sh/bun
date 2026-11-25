import { price } from "./tax.mjs";
console.log("cart.mjs runs");
export const label = "cart";
export const total = () => price();
export const atLoad = (() => {
  try {
    return price();
  } catch (error) {
    return error.name;
  }
})();
