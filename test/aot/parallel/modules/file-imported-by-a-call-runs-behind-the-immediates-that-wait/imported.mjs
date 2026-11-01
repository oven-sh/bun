console.log("imported");
setImmediate(() => console.log("immediate of imported"));
queueMicrotask(() => console.log("job of imported"));
export const v = 1;
