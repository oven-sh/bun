console.log("main runs");
import("./root.mjs").then(() => console.log("imported"));
let step = Promise.resolve();
for (let i = 1; i <= 12; i++) step = step.then(() => console.log("main job", i));
