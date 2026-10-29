import { sumOfTable } from "./a.mjs";
let tooEarly;
try {
  tooEarly = sumOfTable(4, 3);
} catch (error) {
  tooEarly = error.constructor.name;
}
export const early = `${sumOfTable(8, 100)} ${tooEarly}`;
