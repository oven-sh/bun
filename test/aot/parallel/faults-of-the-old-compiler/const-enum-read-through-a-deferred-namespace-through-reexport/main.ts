import defer * as n from "./middle.ts";
const c = n.X.C;
console.log("X.C " + c + ((globalThis as any).ran === true ? ", owner ran" : ", owner did not run") + ((globalThis as any).middleRan === true ? ", middle ran" : ", middle did not run"));
