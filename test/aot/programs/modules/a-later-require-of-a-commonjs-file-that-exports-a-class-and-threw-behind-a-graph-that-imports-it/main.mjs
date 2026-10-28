import "./late.cjs";
import Thing from "./file.cjs";
console.log("main begins", typeof Thing);
await 0;
console.log("main ends");
