import defer * as n from "./owner.ts";
let held: n.X | undefined;
console.log("held " + held + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run"));
