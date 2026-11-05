import * as dep from "./dep.cjs";
export const seen = () => Object.keys(dep).sort().join("+");
