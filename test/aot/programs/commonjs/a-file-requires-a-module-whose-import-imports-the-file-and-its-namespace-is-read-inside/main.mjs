import * as file from "./file.cjs";
console.log("the entry point reads", typeof file.Made, file.text, file.nothing, file.late);
console.log("the entry point calls", file.Made.name, new file.Made().answer());
