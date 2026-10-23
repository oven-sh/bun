// Bun runs every file as a module: a constant, a function with a body, and a name that is both an interface and a constant belong to the script that has them. Plain Bun answers `undefined` to each `typeof`, and the build says so.
import "./with-code";
console.log(typeof counted, typeof helper, typeof Both);
const both: Both = { a: 1 };
console.log(both);
