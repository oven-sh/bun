const first = import("./left.mjs").then(() => "left+", error => "left!" + error.name);
await null; 
const second = import("./right.mjs").then(() => "right+", error => "right!" + error.name);
line.push(await first, await second);
