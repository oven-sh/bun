import * as dep from "./dep.cjs";
export const seen = () => { const all = { ...dep }; return all.value() + ":" + Object.keys(all).sort().join("+"); };
