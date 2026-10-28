import file from "./file.cjs";
console.log("the entry point reads", file.late);
queueMicrotask(() => console.log("a job reads", file.late));
