// A type argument of JSON.parse that the program declares is erased.
const settled = () => new Promise(resolve => setTimeout(resolve, 1));
console.log("# called");
await import("./called/program.ts");
await settled();
console.log("# in-a-generic-function");
await import("./in-a-generic-function/program.ts");
await settled();
console.log("# instantiated-without-a-call");
await import("./instantiated-without-a-call/program.ts");
await settled();
console.log("# held-under-a-generic-type");
await import("./held-under-a-generic-type/program.ts");
await settled();
console.log("# taken-out-of-json");
await import("./taken-out-of-json/program.ts");
await settled();
