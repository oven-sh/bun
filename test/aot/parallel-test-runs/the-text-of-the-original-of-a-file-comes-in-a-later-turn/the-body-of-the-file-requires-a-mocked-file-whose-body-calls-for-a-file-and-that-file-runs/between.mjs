console.log("the file between begins");
const { depth } = await import("./below.mjs");
console.log("the file between goes on:", depth);
export const middle = "between " + depth;
