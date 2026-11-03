import { hoisted, late } from "./cycle-a.mjs";
const read = () => {
  try {
    return late;
  } catch (error) {
    return error.constructor.name;
  }
};
console.log("cycle-b runs", hoisted());
export const b = "b saw " + read();
export const callsA = () => hoisted() + " " + read();
