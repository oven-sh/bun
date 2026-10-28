import "./late.cjs";
import "./during.cjs";
import { first, count } from "./file.cjs";
console.log("main begins", first, count());
await 0;
console.log("main ends");
