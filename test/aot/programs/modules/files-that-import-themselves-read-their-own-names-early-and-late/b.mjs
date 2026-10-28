import * as self from "./b.mjs";
import { a } from "./a.mjs";
try {
  console.log("b: a, early", a);
} catch (error) {
  console.log("b: a, early", error.name);
}
export const b = "b";
console.log("b: own", self.b);
