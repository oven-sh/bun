export let stage = "before";
console.log("dynamic-cycle-a starts");
const inner = await new Promise((resolve, reject) => import("./dynamic-cycle-b.mjs").then(resolve, reject));
stage = "after";
export const seen = inner.saw + ", then " + stage;
