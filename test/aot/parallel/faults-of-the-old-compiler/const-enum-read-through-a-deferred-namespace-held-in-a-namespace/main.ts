import * as m from "./middle.ts";
const before = (globalThis as any).ran === true;
const c = m.later.X.C;
console.log("X.C " + c + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run") + ", before the read: " + before);
