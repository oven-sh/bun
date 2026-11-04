import defer * as n from "./owner.ts";
const c = n.X.C;
console.log("X.C " + c + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run"));
