export let second = 2;
console.log("module begins");
import("./file.cjs").then(() => console.log("module then file"));
console.log("module ends");
