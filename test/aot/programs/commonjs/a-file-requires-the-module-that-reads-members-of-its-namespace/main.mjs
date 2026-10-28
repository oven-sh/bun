import * as file from "./file.cjs";
console.log("the entry point reads", file.early, typeof file.call, file.late);
console.log("the entry point calls", file.call());
