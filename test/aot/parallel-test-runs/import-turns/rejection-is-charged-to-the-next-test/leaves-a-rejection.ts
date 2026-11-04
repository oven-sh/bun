console.log("the file runs");
queueMicrotask(() => console.log("a job of the file"));
Promise.reject(new Error("rejected in the file"));
export const value = 1;
