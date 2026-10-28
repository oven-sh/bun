import { column } from "./tables.js";
const nothing = new Map([
  ["low", 1],
  ["high", 2],
]);
export const prices = column("prices", nothing);
export const neverRead = {
  get taken() {
    return nothing;
  },
};
