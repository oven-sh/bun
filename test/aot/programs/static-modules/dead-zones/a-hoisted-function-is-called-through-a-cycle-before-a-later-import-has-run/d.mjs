import { f } from "./a.mjs";
try {
  console.log("d", f());
} catch (error) {
  console.log("d", error.constructor.name);
}
