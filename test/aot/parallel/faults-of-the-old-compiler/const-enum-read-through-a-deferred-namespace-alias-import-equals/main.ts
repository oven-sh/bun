import defer * as n from "./owner.ts";
import Y = n.X;
const c = Y.C;
console.log("X.C " + c + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run"));
