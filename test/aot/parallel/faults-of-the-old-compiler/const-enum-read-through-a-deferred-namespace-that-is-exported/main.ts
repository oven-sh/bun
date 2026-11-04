import { later } from "./middle.ts";
const before = (globalThis as any).ran === true;
const c = later.X.C;
console.log("X.C " + c + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run") + ", before the read: " + before);
