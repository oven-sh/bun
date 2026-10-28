import { early } from "./main.mjs";
try {
  console.log("caller:", early());
} catch (error) {
  console.log("caller:", error.constructor.name);
}
