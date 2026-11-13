import * as prices from "./price.mjs";
import * as cart from "./cart.mjs";
console.log("shop.mjs runs");
export const describe = () => [prices.price(), prices.labeled(), cart.total(), cart.atLoad].join(" | ");
