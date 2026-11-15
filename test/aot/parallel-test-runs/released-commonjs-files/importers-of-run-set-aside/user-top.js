import { flag, plain } from "./dep.cjs";
import * as ns from "./dep.cjs";
console.log("| body of user-top");
export const values = () => [flag, plain, ns.flag].join();
