import defer * as n from "./owner.ts";
n.X.C;
console.log("read" + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run"));
