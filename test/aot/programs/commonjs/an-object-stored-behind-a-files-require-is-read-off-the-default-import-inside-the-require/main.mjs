import file from "./file.cjs";
console.log("the entry point reads", file.early, typeof file.late, file.late);
setTimeout(() => console.log("a timer reads", file.early, typeof file.late, file.late));
