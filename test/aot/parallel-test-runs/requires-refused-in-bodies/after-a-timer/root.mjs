import { number } from "./slow.mjs";
export const id = "root " + number;
try {
  console.log("body", require("./user.mjs").seen());
} catch (error) {
  console.log("body", error.name);
}
