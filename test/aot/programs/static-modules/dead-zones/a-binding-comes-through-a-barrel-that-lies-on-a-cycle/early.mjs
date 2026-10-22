import { x } from "./barrel.mjs";
try {
  console.log("early", x);
} catch (error) {
  console.log("early", error.constructor.name);
}
