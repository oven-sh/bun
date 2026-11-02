Error.stackTraceLimit = 0;
const error: any = new Error("z");
error[0] = new WritableStream();
console.log(error);
