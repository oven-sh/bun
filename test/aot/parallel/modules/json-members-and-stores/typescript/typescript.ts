import whole, { a } from "./data.json";
import * as ns from "./data.json";
(whole as { a: number }).a = 99;
const sum: number = a + ns.a;
console.log(sum, whole.a);
