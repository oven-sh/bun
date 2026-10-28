import * as file from "./file.cjs";
console.log("the entry point reads", file.early, file.late, file.default);
setTimeout(() => console.log("a timer reads", file.early, file.late, file.default));
