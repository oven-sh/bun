// The await calls `then` of the file on its namespace, so that function sees every export, also those that nobody here reads.
const { a } = await import("./other.mjs");
console.log(a);
