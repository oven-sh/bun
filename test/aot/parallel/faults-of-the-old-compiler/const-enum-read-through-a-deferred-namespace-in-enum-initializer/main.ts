import defer * as n from "./owner.ts";
const before = (globalThis as any).ran === true;
enum Y { D = n.X.C }
console.log(JSON.stringify(Y) + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run") + ", before the enum: " + before);
