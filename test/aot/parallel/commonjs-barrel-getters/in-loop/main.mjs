import { light } from "./barrel.cjs";
let sum = 0;
for (let i = 0; i < 3; i++) sum += light;
console.log("main", sum);
