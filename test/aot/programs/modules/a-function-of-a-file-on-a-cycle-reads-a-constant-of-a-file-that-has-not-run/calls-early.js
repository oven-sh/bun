import { describe } from "./reader.js";
try {
  console.log("early:", describe());
} catch (error) {
  console.log("early:", error.constructor.name);
}
