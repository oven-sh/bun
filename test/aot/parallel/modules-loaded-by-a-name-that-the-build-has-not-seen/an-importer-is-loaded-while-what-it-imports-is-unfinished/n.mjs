import { late } from "./m.mjs";
export const read = () => {
  try {
    return "late " + (late.x > 0);
  } catch (error) {
    return "what throws " + error.name;
  }
};
let atOnce;
try {
  atOnce = "late " + (late.x > 0);
} catch (error) {
  atOnce = "throws " + error.name;
}
console.log("n:", atOnce);
