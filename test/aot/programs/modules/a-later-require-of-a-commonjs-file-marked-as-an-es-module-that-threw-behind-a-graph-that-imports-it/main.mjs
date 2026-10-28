import "./late.cjs";
import value, { first } from "./file.cjs";
console.log("main begins", typeof value, first);
await 0;
console.log("main ends");
